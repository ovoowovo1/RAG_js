// services/graphDocumentService.js

const { RecursiveCharacterTextSplitter } = require('langchain/text_splitter');
const { Document } = require('langchain/document');
const { extractTextByPage } = require('../utils/pdfUtils');
const neo4jService = require('./neo4jService');
const crypto = require('crypto');
const apiKeyManager = require('../utils/apiKeyManager');

// --- 初始化模型 ---
const textSplitter = new RecursiveCharacterTextSplitter({ chunkSize: 1500, chunkOverlap: 400 });
const embeddings = apiKeyManager.getEmbeddingModel();


/**
 * 簡單的請求函式，它使用傳入的模型實例來發起請求。
 * @param {import('@langchain/google-genai').ChatGoogleGenerativeAI} model - 從管理器獲取的模型實例
 * @param {string} prompt - 要發送的提示
 * @returns {Promise<object>}
 */
async function invokeModel(model, prompt) {
    try {
        return await model.invoke(prompt);
    } catch (err) {
        // 將錯誤向上拋出，由外層的批次處理器來決定如何應對
        throw err;
    }
}

/**
 * 主要的協調函式：處理上傳的 PDF，提取實體，並在 Neo4j 中建立一個完整的圖譜
 */
async function processAndCreateGraph(file) {
    console.log(`[Graph] 開始處理檔案: ${file.name}`);
    const fileHash = crypto.createHash('sha256').update(file.data).digest('hex');

    const existingFile = await neo4jService.findDocumentByHash(fileHash);
    if (existingFile) {
        console.log(`[Graph] 檔案 ${file.name} 已存在。跳過處理。`);
        return { message: '檔案已存在，跳過處理', fileId: existingFile.id, isNew: false };
    }

    const pagesText = await extractTextByPage(file.data);
    const docs = pagesText.map((pageContent, i) => new Document({
        pageContent,
        metadata: { source: file.name, pageNumber: i + 1 }
    })).filter(doc => doc.pageContent.trim().length > 10);

    if (docs.length === 0) {
        console.log(`[Graph] 檔案 ${file.name} 沒有有效內容。`);
        return { message: '檔案沒有可處理的內容', isNew: true };
    }

    const chunks = await textSplitter.splitDocuments(docs);
    console.log(`[Graph] 文件分塊完成，共 ${chunks.length} 個塊。`);

    console.log('[CRITICAL-DEBUG] 所有 Chunks 的原始內容:', JSON.stringify(chunks.map(c => c.pageContent), null, 2));

    if (apiKeyManager.keys.length === 0) {
        throw new Error("設定錯誤：請在 .env 中提供 GOOGLE_API_KEY_LIST。");
    }

    const BATCH_SIZE = 30; // Embedding 可以用稍大的批次
    let allVectors = [];

    // --- 【新的向量生成批次處理迴圈】 --- 
    console.log(`[Graph] 開始分批生成向量，共找到 ${apiKeyManager.keys.length} 個可用的 API Key。`);
    apiKeyManager.resetKeyIndex(); // 確保從第一個 Key 開始

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + BATCH_SIZE);
        const batchTexts = batchChunks.map(c => c.pageContent);
        console.log(`[Graph] 正在準備生成向量批次: ${Math.floor(i / BATCH_SIZE) + 1} (塊 ${i + 1} 到 ${Math.min(i + BATCH_SIZE, chunks.length)})`);

        let batchSuccess = false;
        while (!batchSuccess) {
            const embeddingsModel = apiKeyManager.getEmbeddingModel();
            if (!embeddingsModel) {
                throw new Error("所有 API Key 的配額都已耗盡，無法生成向量。");
            }

            try {
                const batchVectors = await embeddingsModel.embedDocuments(batchTexts);

                // 增加一個驗證，防止 API 回傳空結果
                if (!batchVectors || batchVectors.length !== batchTexts.length || batchVectors.some(v => !v || v.length === 0)) {
                    throw new Error('API 回傳了無效或空的向量結果，將嘗試重試。');
                }

                allVectors = allVectors.concat(batchVectors);
                batchSuccess = true;
                console.log(`[Graph] 向量批次 ${Math.floor(i / BATCH_SIZE) + 1} 生成成功。`);

            } catch (err) {
                console.warn(`[Graph] 向量生成批次遇到錯誤: ${err.message}`);
                const hasNextKey = apiKeyManager.switchToNextKey();
                if (!hasNextKey) {
                    throw new Error("所有 API Key 均已嘗試，向量生成最終失敗。");
                }
                console.log("[Graph] 正在用新的 API Key 重試當前向量批次...");
                await new Promise(resolve => setTimeout(resolve, 1000)); // 等待 1 秒再重試
            }
        }
    }
    console.log(`[Graph] 所有向量均已成功生成，共 ${allVectors.length} 個。`);
    //  --- 【向量生成迴圈結束】 --- 


    // --- 【圖譜提取批次處理迴圈】 --- 
    console.log(`[Graph] 開始分批提取實體與關係...`);
    apiKeyManager.resetKeyIndex(); // 重設金鑰索引，讓圖譜提取也從第一個 Key 開始
    const GRAPH_BATCH_SIZE = 5;
    let allExtractionResults = [];

    for (let i = 0; i < chunks.length; i += GRAPH_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + GRAPH_BATCH_SIZE);
        console.log(`[Graph] 正在準備處理圖譜批次: ${Math.floor(i / GRAPH_BATCH_SIZE) + 1} (塊 ${i + 1} 到 ${Math.min(i + GRAPH_BATCH_SIZE, chunks.length)})`);

        let batchSuccess = false;
        while (!batchSuccess) {
            const model = apiKeyManager.getGraphExtractionModel();
            if (!model) {
                throw new Error("所有 API Key 的配額都已耗盡，無法繼續處理。");
            }

            try {
                const extractionPromises = batchChunks.map((chunk, index) => {
                    const prompt = `
                   您是一位通用資訊提取 AI。您的任務是分析任何類型的文本，準確地提取出其中的核心實體（Entities）和它們之間的明確關係（Relationships），並以嚴格的 JSON 格式輸出。

                    ### 核心規則:

                    1.  **實體 (Entity) 提取**:
                        -   識別文本中代表真實世界物體或核心概念的名詞或名詞片語。
                        -   **實體的類型 (type)** 應該是根據文本上下文推斷出的通用、單一的名詞。例如：'人物', '組織', '地點', '產品', '技術', '日期', '概念', '事件'。請不要使用預設的固定列表，而是根據內容靈活判斷。

                    2.  **關係 (Relationship) 提取**:
                        -   關係必須是文本中**清晰、明確陳述的直接聯繫**。
                        -   **關係的類型 (type)** 應該用一個簡潔的、描述性的動詞或動詞片語來表示，以準確反映實體間的互動。例如：'位於', '發明了', '收購了', '擁有', '合作夥伴是', '發佈於'。

                    3.  **完全基於文本 (Strictly Text-Based)**:
                        -   您的所有輸出都**必須嚴格基於**所提供的文本。
                        -   **請勿推斷**文本中未提及的關係，也**不要使用**任何您自身的外部知識。

                    4.  **格式與一致性**:
                        -   關係中的 'source' 和 'target' 名稱，必須與 'entities' 列表中對應的實體 'name' **完全一致**。
                        -   如果沒有找到任何實體或關係，必須返回包含空陣列的 JSON: \`{"entities": [], "relationships": []}\`。
                        -   絕對不要在 JSON 物件之外添加任何解釋、註解或對話。
                        
                    ### 請根據以上規則，分析以下文本:
                    ---
                    ${chunk.pageContent}
                    ---
                        
                        `;
                    return invokeModel(model, prompt);
                });

                const batchResults = await Promise.all(extractionPromises);


                console.log(`[Graph-Debug] AI 模型回傳的原始結果 (批次 ${Math.floor(i / GRAPH_BATCH_SIZE) + 1}):`, JSON.stringify(batchResults, null, 2));

                // 增加一個驗證，確保回傳結果不是空的
                if (batchResults.some(r => r === null || r === undefined)) {
                    console.warn(`[Graph-Debug] 批次中有一個或多個 AI 回傳結果為 null 或 undefined，這可能表示結構化輸出解析失敗。`);
                }

                allExtractionResults = allExtractionResults.concat(batchResults);
                batchSuccess = true;
                console.log(`[Graph] 圖譜批次 ${Math.floor(i / GRAPH_BATCH_SIZE) + 1} 處理成功。`);

            } catch (err) {
                if (err && err.message && err.message.includes('429')) {
                    console.warn(`[Graph] 圖譜批次處理時遇到 429 速率限制錯誤。`);
                    const hasNextKey = apiKeyManager.switchToNextKey();
                    if (!hasNextKey) {
                        throw new Error("所有 API Key 均已達到速率限制，處理終止。");
                    }
                    console.log("[Graph] 正在用新的 API Key 重試當前圖譜批次...");
                } else {
                    console.error("[Graph] 遇到無法恢復的錯誤，處理終止:", err);
                    throw err;
                }
            }
        }

        if (i + GRAPH_BATCH_SIZE < chunks.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    console.log(`[Graph] 所有塊的實體與關係提取完成。`);

    // 6. 寫入 Neo4j 資料庫
    const chunksWithGraph = chunks.map((chunk, i) => ({
        text: chunk.pageContent,
        metadata: chunk.metadata,
        embedding: allVectors[i], //  使用新的 allVectors
        entities: allExtractionResults[i] ? (allExtractionResults[i].entities || []) : [],
        relationships: allExtractionResults[i] ? (allExtractionResults[i].relationships || []) : []
    }));


    console.log(`[Graph] 準備將圖譜寫入 Neo4j...`);
    const documentData = {
        name: file.name,
        size: file.size,
        hash: fileHash,
        mimetype: file.mimetype
    };

    const result = await neo4jService.createGraphFromDocument(documentData, chunksWithGraph);

    console.log(`[Graph] 檔案 ${file.name} 已成功建立圖譜，文件節點 ID: ${result.fileId}`);
    return {
        message: `成功為 ${file.name} 建立圖譜`,
        fileId: result.fileId,
        chunksCount: chunks.length,
        entitiesCount: chunksWithGraph.reduce((sum, c) => sum + (c.entities ? c.entities.length : 0), 0),
        relationshipsCount: chunksWithGraph.reduce((sum, c) => sum + (c.relationships ? c.relationships.length : 0), 0),
        isNew: true
    };
}

module.exports = { processAndCreateGraph };