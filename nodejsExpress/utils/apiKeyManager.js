// utils/apiKeyManager.js

const { GoogleGenerativeAIEmbeddings, ChatGoogleGenerativeAI } = require('@langchain/google-genai');

/**
 * AI 模型提供者 (AI Model Provider)
 * 統一管理和提供所有與 Google Generative AI 相關的模型實例。
 */
const apiKeyManager = {
    keys: [],
    currentIndex: 0,

    /**
     * 從環境變數初始化金鑰列表。
     */
    init: function() {
        const apiKeysEnv = process.env.GOOGLE_API_KEY_LIST || '';
        this.keys = apiKeysEnv.split(',').map(k => k.trim()).filter(k => k);
        
        this.currentIndex = 0;

        if (this.keys.length === 0) {
            console.warn("[ApiKeyManager] 警告：未在 .env 檔案中找到 GOOGLE_API_KEY_LIST。");
        }
    },

    /**
     * 【新】重設金鑰索引，以便新的處理流程可以從頭開始。
     */
    resetKeyIndex: function() {
        console.log('[ApiKeyManager] 金鑰索引已重設為 0。');
        this.currentIndex = 0;
    },

    /**
     * 【升級版】獲取 Embedding 模型實例 (支持金鑰輪換)
     * @returns {GoogleGenerativeAIEmbeddings | null}
     */
    getEmbeddingModel: function() {
        if (this.keys.length === 0 || this.currentIndex >= this.keys.length) {
            return null; // 所有金鑰都已嘗試過
        }

        const apiKey = this.keys[this.currentIndex];
        console.log(`[ApiKeyManager] 正在使用索引為 ${this.currentIndex} 的 API Key 建立 Embedding 模型。`);
        
        return new GoogleGenerativeAIEmbeddings({
            model: process.env.GOOGLE_AI_EMBEDDINGS || 'gemini-embedding-001',
            apiKey: apiKey
        });
    },

    /**
     * 獲取用於「查詢時實體提取」的 Chat 模型
     * @returns {ChatGoogleGenerativeAI}
     */
    getQueryEntityExtractionModel: function() {
        // 這種單次、快速的呼叫使用清單中的第一把金鑰
        if (this.keys.length === 0) return null;
        const apiKey = this.keys[0];

        return new ChatGoogleGenerativeAI({
            model: process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash',
            apiKey: apiKey
        }).withStructuredOutput({
            // ... (結構化輸出定義不變)
            type: "object",
            properties: {
                entities: {
                    type: "array",
                    description: "An array of key entities extracted from the text.",
                    items: { type: "string", description: "A single key entity." }
                }
            },
            required: ["entities"]
        });
    },

    /**
     * 獲取用於「圖譜生成」的 Chat 模型 (支持金鑰輪換)
     * @returns {ChatGoogleGenerativeAI | null}
     */
    getGraphExtractionModel: function() {
        if (this.keys.length === 0 || this.currentIndex >= this.keys.length) {
            return null; // 所有金鑰都已嘗試過
        }
        
        const apiKey = this.keys[this.currentIndex];
        console.log(`[ApiKeyManager] 正在使用索引為 ${this.currentIndex} 的 API Key 建立圖譜模型。`);
        
        return new ChatGoogleGenerativeAI({
            model: process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash',
            apiKey: apiKey
        }).withStructuredOutput({
             type: "object",
            properties: {
                entities: {
                    type: "array",
                    description: "從文本中提取的實體",
                    items: {
                        type: "object",
                        properties: { name: { type: "string" }, type: { type: "string" } },
                        required: ["name", "type"]
                    }
                },
                relationships: {
                    type: "array",
                    description: "在實體之間識別出的明確關係",
                    items: {
                        type: "object",
                        properties: { source: { type: "string" }, target: { type: "string" }, type: { type: "string" } },
                        required: ["source", "target", "type"]
                    }
                }
            },
            required: ["entities", "relationships"]
        });
    },

    /**
     * 【新】獲取用於「回答生成」的 Chat 模型 (支持金鑰輪換與結構化輸出)
     * @param {object} schema - 結構化輸出用的 JSON Schema
     * @param {object} options - 可選參數，如 { temperature: 0.7 }
     * @returns {ChatGoogleGenerativeAI | null}
     */
    getAnswerGenerationModel: function(schema, options = {}) {
        if (this.keys.length === 0 || this.currentIndex >= this.keys.length) {
            return null; // 所有金鑰都已嘗試過
        }

        const apiKey = this.keys[this.currentIndex];
        console.log(`[ApiKeyManager] 正在使用索引為 ${this.currentIndex} 的 API Key 建立回答生成模型。`);

        const temperature = typeof options.temperature === 'number' ? options.temperature : 0.7;
        const modelName = process.env.GOOGLE_AI_MODEL || 'gemini-2.5-flash';

        const baseModel = new ChatGoogleGenerativeAI({
            model: modelName,
            temperature,
            apiKey
        });

        return schema ? baseModel.withStructuredOutput(schema) : baseModel;
    },

    /**
     * 將索引切換到下一個 API Key。
     * @returns {boolean}
     */
    switchToNextKey: function() {
        this.currentIndex++;
        if (this.currentIndex < this.keys.length) {
            console.log(`[ApiKeyManager] API Key 可能遇到問題，自動切換到下一個 Key (新索引: ${this.currentIndex})。`);
            return true;
        } else {
            console.error('[ApiKeyManager] 所有 API Key 都已嘗試過，沒有更多可用的金鑰。');
            return false;
        }
    }
};

apiKeyManager.init();
module.exports = apiKeyManager;