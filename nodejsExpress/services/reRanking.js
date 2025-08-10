const axios = require('axios');

/**
 * 使用 Jina Reranker API 對文件進行重排序
 * @param {string} query - 用戶的查詢問題
 * @param {Array<object>} documents - 從資料庫檢索到的文件陣列，每個物件應包含 content 屬性
 * @returns {Promise<Array<object>>} - 返回重排序後的 top_n 個文件
 */
async function rerankWithJina(query, documents) {
    // 1. 準備 Jina API 需要的資料格式
    // Jina 需要的 documents 格式是 [{ text: "..." }, { text: "..." }]
    // 我們的 document 格式是 [{ content: "...", metadata: {...} }]
    // 因此我們需要做個轉換，同時保留原始文件以便後續使用
    const docsForJina = documents.map(doc => ({ text: doc.content }));

    const requestData = {
        model: "jina-reranker-v2-base-multilingual", // 使用多語言模型
        query: query,
        documents: docsForJina,
        top_n: 10, // 指定重排序後要返回前 3 名的文件
        return_documents: false // 設為 false，只返回索引和分數，速度較快
    };

    try {
        console.log(`正在使用 Jina Reranker 對 ${documents.length} 個文件進行重排序...`);

        const response = await axios.post(
            'https://api.jina.ai/v1/rerank',
            requestData, // request body
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.JINA_API_KEY}` // 請確保 JINA_API_KEY 已設置在環境變數
                }
            }
        );

        if (response.status !== 200) {
            throw new Error(`Jina API error: ${response.status} - ${response.statusText}`);
        }

        const rerankedResults = response.data.results;
        console.log(`Jina Reranker 完成，返回 ${rerankedResults.length} 個結果。`);

        // 2. 根據 Jina 返回的結果重新組合文件
        // Jina 返回的 results 是一個包含 { index, relevance_score } 的陣列
        // index 對應我們傳入的 documents 陣列的索引
        const rerankedDocs = rerankedResults.map(result => {
            const originalDoc = documents[result.index];
            // 我們可以將 Jina 的分數附加到 metadata 中，以便後續分析
            originalDoc.metadata.relevance_score = result.relevance_score;
            return originalDoc;
        });

        return rerankedDocs;

    } catch (error) {
        console.error('Jina Reranker 請求失敗:', error.response ? error.response.data : error.message);
        // 如果 Reranker 失敗，為了不中斷流程，可以直接返回原始文件
        // 這樣系統仍然可以運作，只是沒有經過重排序的優化
        console.warn('由於 Reranker 失敗，將使用原始檢索結果。');
        return documents.slice(0, 3); // 返回前 3 個原始文件作為備用
    }
}

module.exports = {
    rerankWithJina
};