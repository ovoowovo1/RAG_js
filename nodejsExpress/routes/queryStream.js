const express = require('express');
const router = express.Router();

const { generateAnswerWithLangChain } = require('../services/aiService');
const neo4jService = require('../services/neo4jService');
const apiKeyManager = require('../utils/apiKeyManager');
const { rerankWithJina } = require('../services/reRanking');

// SSE 查詢路由
router.post('/query-stream', async (req, res) => {
    // 設置 SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
        'X-Accel-Buffering': 'no' // 禁用 nginx 緩衝
    });

    console.log('SSE 連接已建立');

    // 發送進度消息的輔助函數
    const sendProgress = (message, data = null, type = 'progress') => {
        const progressData = {
            type: type,
            message,
            data,
            timestamp: new Date().toISOString()
        };
        const jsonString = JSON.stringify(progressData);
        console.log('發送進度:', message);
        res.write(jsonString + '\n');
        // 強制刷新輸出
        if (res.flush) {
            res.flush();
        }
    };

    // 發送最終結果的輔助函數
    const sendResult = (result) => {
        const resultData = {
            type: 'result',
            ...result,
            timestamp: new Date().toISOString()
        };
        res.write(JSON.stringify(resultData) + '\n');
        res.end();
    };

    try {
        const { question, selectedFileIds = [] } = req.body;
        if (!question || !question.trim()) {
            return res.status(400).json({ error: '請提供查詢問題' });
        }

        console.log(`收到查詢: ${question}`);
        console.log(`篩選文件 IDs: ${selectedFileIds.join(', ')}`);
        if (selectedFileIds.length === 0) {
            sendProgress('⚠️ 未選擇任何文件，將使用全部文件進行檢索。', null, 'progress');
            return res.status(400).json({ error: '請至少選擇一個文件進行檢索' });
        }

        sendProgress('開始處理查詢...', { question: question.trim() }, null, 'progress');

        // --- 步驟 1: 平行執行三種檢索 ---
        sendProgress('正在平行執行圖譜檢索、向量檢索和全文檢索...', null, 'progress');

        // 任務 1: 圖譜/實體檢索
        const graphSearchPromise = (async () => {
            try {
                sendProgress('🔍 [圖譜檢索] 正在提取實體...', null, 'graphProgress');
                const extractionPrompt = `從以下問題中提取出最關鍵的人物、地點、組織或概念等實體。只返回實體名稱。\n問題: "${question}"`;
                const entityModel = apiKeyManager.getQueryEntityExtractionModel();
                const extractionResult = await entityModel.invoke(extractionPrompt);
                const extractedEntities = (extractionResult.entities || []).filter(e => e);

                sendProgress(`[圖譜檢索] 提取到實體: [${ extractedEntities.join(', ') }]，正在檢索...`, null, 'progress');
                const results = await neo4jService.retrieveContextByEntities(extractedEntities, selectedFileIds);
                if (results.length > 0) {
                    sendProgress(`✅[圖譜檢索] 完成！找到 ${ results.length } 個相關結果`, results.length, 'graph');
                } else {
                    sendProgress('⚠️ [圖譜檢索] 未提取到實體，跳過此步驟', 0, 'graph');
                }
                return results;
            } catch (error) {
                sendProgress(`❌[圖譜檢索] 發生錯誤: ${ error.message }`, 0, 'graph');
                return [];
            }
        })();

        // 任務 2: 向量檢索
        const vectorSearchPromise = (async () => {
            try {
                sendProgress('🔍 [向量檢索] 正在生成查詢向量...', null, 'vectorProgress');
                const embeddings = apiKeyManager.getEmbeddingModel();
                const queryVector = await embeddings.embedQuery(question.trim());

                sendProgress('[向量檢索] 正在檢索圖譜中的向量...');
                const results = await neo4jService.retrieveGraphContext(queryVector, 20, selectedFileIds);

                if (results.length > 0) {
                    sendProgress(`✅[向量檢索] 完成！找到 ${ results.length } 個相關結果`, results.length, 'vector');
                } else {
                    sendProgress(`⚠️[向量檢索] 未找到相關結果`, 0, 'vector');
                }
                return results;
            } catch (error) {
                sendProgress(`❌[向量檢索] 發生錯誤: ${ error.message }`, 0, 'vector');
                return [];
            }
        })();

        // 任務 3: 全文檢索
        const fullTextSearchPromise = (async () => {
            try {
                sendProgress('🔍 [全文檢索] 正在執行全文檢索...', null, 'fulltextProgress');
                const results = await neo4jService.retrieveContextByKeywords(question, selectedFileIds);

                if (results.length > 0) {
                    sendProgress(`✅[全文檢索] 完成！找到 ${ results.length } 個相關結果`, results.length, 'fulltext');
                } else {
                    sendProgress(`⚠️[全文檢索] 未找到相關結果`, 0, 'fulltext');
                }
                return results;
            } catch (error) {
                sendProgress(`❌[全文檢索] 發生錯誤: ${ error.message }`, 0, 'fulltext');
                return [];
            }
        })();

        // 等待三種檢索都完成
        const [graphResults, vectorResults, fullTextResults] = await Promise.all([
            graphSearchPromise,
            vectorSearchPromise,
            fullTextSearchPromise
        ]);


        // --- 步驟 4: 結果融合與去重 ---
        sendProgress('🔄 正在融合和去重檢索結果...', null, 'progress');
        const combinedDocsMap = new Map();
        [...graphResults, ...vectorResults, ...fullTextResults].forEach(doc => {
            if (doc && doc.chunkId) {
                combinedDocsMap.set(doc.chunkId, doc);
            }
        });
        let initialDocs = Array.from(combinedDocsMap.values());
        sendProgress(`✅ 融合去重完成！共得到 ${ initialDocs.length } 個候選文檔`, initialDocs.length, 'merge');

        if (initialDocs.length === 0) {
            return sendResult({
                question: question.trim(),
                answer: '抱歉，在您指定的文件中找不到任何相關資訊。',
                answer_with_citations: [],
                raw_sources: []
            });
        }

        // --- 步驟 5: 格式化上下文並生成回答 ---
        sendProgress('🤖 正在生成 AI 回答...', null, 'progress');
        const formattedContext = initialDocs.map((doc, index) => {
            const metadata = doc.metadata || doc;
            const content = doc.content || doc.text;
            const sourceInfo = `source_file: "${metadata.source}", page_number: "${metadata.page || metadata.pageNumber}", file_id: "${metadata.fileId}", file_chunk_id: "${metadata.chunkId}"`;
            return `[上下文來源 ${ index + 1}]\n${ sourceInfo } \n內容: """\n${content}\n"""`;
        }).join('\n\n');

        const aiResponse = await generateAnswerWithLangChain(formattedContext, question.trim());

        const sources = initialDocs.map(doc => {
            const metadata = doc.metadata || doc;
            const content = doc.content || doc.text;
            //console.log(`處理文檔: ${ metadata.source }, 頁碼: ${ metadata.page || metadata.pageNumber }, chunkId: ${ metadata.chunkId } `);
            //console.log(`${ content } `);
            return {
                content: content,
                source: metadata.source || '未知來源',
                pageNumber: metadata.page || metadata.pageNumber || '未知頁碼',
                score: doc.score || doc.relevance_score,
                fileId: metadata.fileId,
                chunkId: metadata.chunkId
            }
        });

        sendProgress('✅ 查詢完成！', null, 'progress');
        sendResult({
            question: question.trim(),
            answer: aiResponse.answer,
            answer_with_citations: aiResponse.answer_with_citations || [],
            raw_sources: sources
        });

    } catch (error) {
        console.error('查詢處理錯誤:', error);
        sendProgress(`❌ 查詢處理失敗: ${ error.message } `, null, 'progress');
        sendResult({
            error: '查詢處理失敗',
            details: error.message
        });
    }
});

module.exports = router;
