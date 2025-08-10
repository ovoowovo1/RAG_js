const apiKeyManager = require('../utils/apiKeyManager')

// 輔助函數：使用 LangChain ChatGoogleGenerativeAI 生成回答
async function generateAnswerWithLangChain(context, question , contextWithFileId, chunkIds) {
    try {
        // 定義 JSON schema 用於結構化輸出
        const schema = {
            type: "object",
            properties: {
                answer: {
                    type: "string",
                    description: "完整的回答（Markdown格式）"
                },
                answer_with_citations: {
                    type: "array",
                    description: "帶有引用標記的回答段落",
                    items: {
                        type: "object",
                        properties: {
                            content_segments: {
                                type: "array",
                                description: "段落中的內容片段，每個片段對應特定來源",
                                items: {
                                    type: "object",
                                    properties: {
                                        segment_text: {
                                            type: "string",
                                            description: "這個片段的文字內容（Markdown格式）"
                                        },
                                        segment_type: {
                                            type: "string",
                                            enum: ["answer_text", "quoted_content", "analysis"],
                                            description: "片段類型：回答文字、引用內容、或分析說明"
                                        },
                                        source_reference: {
                                            type: "object",
                                            properties: {
                                                source_file: {
                                                    type: "string",
                                                    description: "來源文件名稱"
                                                },
                                                file_id: {
                                                    type: "string",
                                                    enum: contextWithFileId,
                                                    description: "來源文件的唯一標識符"
                                                },
                                                file_chunk_id: {
                                                    type: "string",
                                                    enum: chunkIds,
                                                    description: "來源文件的塊ID"
                                                },
                                                page_number: {
                                                    type: "string",
                                                    description: "頁碼"
                                                },
                                                source_index: {
                                                    type: "number",
                                                    description: "來源在原始內容中的索引（從1開始）"
                                                },
                                            },
                                            required: ["source_file", "file_id", "file_chunk_id", "page_number", "source_index"]
                                        }
                                    },
                                    required: ["segment_text", "segment_type", "source_reference"]
                                }
                            }
                        },
                        required: [ "content_segments"]
                    }
                },
            },
            required: ["answer", "answer_with_citations"]
        }

        //console.log(context)

        const prompt = `
        你的任務是嚴格根據我提供的內容來回答問題，並使用 Markdown 格式回應。
        請遵循以下推理規則：
        1.  **識別並聚焦**: 首先，請仔細閱讀所有內容，並識別出哪些片段與回答「問題」直接相關。
        2.  **忽略無關資訊**: 你的回答必須完全基於那些被你識別為相關的資訊。**主動忽略**所有不相關或矛盾的內容。
        3.  **直接回答**: 如果在相關片段中找到了答案，請直接回答。
        4.  **類比推理**：如果「問題」詢問的是「內容」中某個主題的變體（例如，內容是A，問題是與A相似的B），請你：
            a. 將「內容」的內容作為基礎框架。
            b. 進行邏輯上的類比和調整，來推導出問題的答案。
            c. 在回答中必須明確指出：「我是根據內容中的【某個主題】為基礎，進行邏輯推斷來回答你的問題，這是一個合理的猜測。」
        5.  **禁止外部知識**：絕對禁止使用任何「內容」之外的知識。如果無法進行邏輯推斷，就回答「根據提供的資料，我無法推斷出答案」。

        **Markdown 格式要求**：
        - 在 segment_text 中必須使用 Markdown 語法
        - 使用雙星號包圍文字來表示粗體，如 **重要信息**
        - 使用單星號包圍文字來表示斜體，如 *輔助信息*
        - 使用井號來創建標題，如 ## 主標題 或 ### 副標題
        - 使用減號或星號來創建列表項目
        - 使用反引號包圍技術名詞，如程式語言名稱

        **重要：完整的來源追蹤**
        對於 answer_with_citations 陣列中的每個 content_segment，無論 segment_type 是什麼：
        
        1. **answer_text 類型**：
           - segment_text 必須使用 Markdown 格式
           - 必須提供準確的 source_file、page_number、source_index、file_id 和 file_chunk_id
           
        2. **quoted_content 類型**：
           - segment_text 使用 Markdown 引用格式
           - 必須提供準確的 source_file、page_number、source_index、file_id 和 file_chunk_id

        3. **analysis 類型**：
           - segment_text 使用 Markdown 格式進行分析說明
           - 必須提供準確的 source_file、page_number、source_index、file_id 和 file_chunk_id

        **每個片段都必須有完整的來源資訊，不允許遺漏任何欄位**

        內容:
        ${context}

        問題:
        ${question}`

        let lastError = null
        while (true) {
            const model = apiKeyManager.getAnswerGenerationModel(schema, { temperature: 0.7 })
            if (!model) {
                if (lastError) throw lastError
                throw new Error('[ApiKeyManager] 沒有可用的 API Key。')
            }

            try {
                const response = await model.invoke(prompt)
                // 使用結構化輸出，response 已經是 JSON 物件
                return response
            } catch (err) {
                lastError = err
                console.error('[aiService] 生成回答失敗，嘗試切換下一把 API Key：', err && err.message ? err.message : err)
                const hasNext = apiKeyManager.switchToNextKey()
                if (!hasNext) {
                    throw err
                }
            }
        }

    } catch (error) {
        console.error('LangChain 生成回答錯誤:', error)
        throw error
    }
}

module.exports = {
    generateAnswerWithLangChain
}
