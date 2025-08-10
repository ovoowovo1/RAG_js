const pdf = require('pdf-parse')
const apiKeyManager = require('./apiKeyManager')

// 隊列系統
class EmbeddingQueue {
    constructor() {
        this.queue = []
        this.isProcessing = false
        this.maxRetries = Infinity // 永不放棄
        this.baseDelay = 2000 // 2 秒基礎延遲
        this.maxDelay = 300000 // 最大延遲 5 分鐘
        this.backoffMultiplier = 1.5 // 較溫和的退避策略
    }

    // 添加任務到隊列
    addTask(texts, retryCount = 0) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                texts,
                retryCount,
                resolve,
                reject,
                timestamp: Date.now()
            })
            
            if (!this.isProcessing) {
                this.processQueue()
            }
        })
    }

    // 處理隊列
    async processQueue() {
        if (this.isProcessing || this.queue.length === 0) {
            return
        }

        this.isProcessing = true
        console.log(`開始處理隊列，剩餘任務: ${this.queue.length}`)

        while (this.queue.length > 0) {
            const task = this.queue.shift()
            
            try {
                const result = await this.executeEmbeddingTask(task.texts)
                
                // 檢查結果是否有效
                if (this.isValidResult(result)) {
                    console.log(`隊列任務成功完成`)
                    task.resolve(result)
                } else {
                    // 結果無效，需要重試
                    await this.handleRetry(task, '回應無效或為空')
                }
                
            } catch (error) {
                console.error(`隊列任務執行錯誤:`, error.message)
                await this.handleRetry(task, error.message)
            }
        }

        this.isProcessing = false
        console.log('隊列處理完成')
    }

    // 處理重試邏輯
    async handleRetry(task, errorMessage) {
        task.retryCount++
        
        // 更溫和的指數退避延遲，避免過長等待
        let delayTime
        if (task.retryCount <= 10) {
            // 前 10 次重試使用較短延遲
            delayTime = Math.min(
                this.baseDelay * Math.pow(this.backoffMultiplier, task.retryCount - 1),
                30000 // 前 10 次最大 30 秒
            )
        } else {
            // 第 11 次以後使用固定的較長延遲
            delayTime = this.maxDelay
        }
        
        console.log(`任務失敗: ${errorMessage}，將在 ${delayTime/1000} 秒後重試 (第 ${task.retryCount} 次重試，永不放棄)`)
        
        // 特殊處理：如果重試次數過多，提供額外資訊
        if (task.retryCount > 20) {
            console.warn(`⚠️  此任務已重試 ${task.retryCount} 次，可能 API 長時間不可用`)
            console.warn(`⚠️  系統將繼續重試，但建議檢查網路連線或 API 配額`)
        }
        
        if (task.retryCount > 50) {
            console.warn(`🚨 此任務已重試 ${task.retryCount} 次，建議檢查 API 金鑰或服務狀態`)
        }
        
        // 延遲後重新加入隊列
        setTimeout(() => {
            this.queue.unshift(task) // 放到隊列前面優先處理
            if (!this.isProcessing) {
                this.processQueue()
            }
        }, delayTime)
    }

    // 檢查結果是否有效
    isValidResult(result) {
        // 更嚴格的驗證，包括檢查向量值
        if (!result || !Array.isArray(result) || result.length === 0) {
            return false
        }
        
        // 檢查每個向量是否有效
        for (const vector of result) {
            if (!Array.isArray(vector) || vector.length === 0) {
                return false
            }
            
            // 檢查是否全為 0 (這可能表示 API 配額耗盡)
            const allZeros = vector.every(val => val === 0)
            if (allZeros) {
                console.warn('⚠️  檢測到全零向量，可能是 API 配額限制')
                return false
            }
            
            // 檢查是否包含有效數值
            const hasValidNumbers = vector.some(val => 
                typeof val === 'number' && 
                !isNaN(val) && 
                isFinite(val) && 
                val !== 0
            )
            
            if (!hasValidNumbers) {
                console.warn('⚠️  向量不包含有效數值')
                return false
            }
        }
        
        return true
    }

    // 執行實際的 embedding 任務
    async executeEmbeddingTask(texts) {
        console.log(`執行 embedding 任務，文字數量: ${texts.length}`)

        let lastError = null
        while (true) {
            const embeddingsModel = apiKeyManager.getEmbeddingModel()
            if (!embeddingsModel) {
                if (lastError) throw lastError
                throw new Error('[ApiKeyManager] 沒有可用的 API Key。')
            }

            try {
                const result = await embeddingsModel.embedDocuments(texts)

                // 詳細記錄回應
                console.log(`Google API 回應: 類型=${typeof result}, 陣列=${Array.isArray(result)}, 長度=${result?.length}`)
                
                if (Array.isArray(result) && result.length > 0) {
                    console.log(`第一個向量: 長度=${result[0]?.length}, 類型=${typeof result[0]}`)
                    
                    // 檢查是否為全零向量
                    if (result[0] && Array.isArray(result[0])) {
                        const firstFewValues = result[0].slice(0, 5)
                        console.log(`前5個向量值: [${firstFewValues.join(', ')}]`)
                        
                        const allZeros = result[0].every(val => val === 0)
                        if (allZeros) {
                            throw new Error('API 返回全零向量，可能是配額限制或服務問題')
                        }
                    }
                }

                return result
                
            } catch (error) {
                lastError = error
                console.error(`API 請求失敗: ${error.message}`)

                const hasNext = apiKeyManager.switchToNextKey()
                if (!hasNext) {
                    // 所有金鑰都嘗試過，將錯誤向上拋出以觸發隊列的重試機制
                    throw error
                }
                console.log('[Embedding] 切換下一個 API Key 後重試當前任務...')
            }
        }
    }
}

// 創建全域隊列實例
const embeddingQueue = new EmbeddingQueue()

// 輔助函數：從PDF提取文字
async function extractTextFromPDF(buffer) {
    try {
        const data = await pdf(buffer)
        return data
    } catch (error) {
        throw new Error(`PDF文字提取失敗: ${error.message}`)
    }
}

// 輔助函數：延遲執行
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// 輔助函數：使用隊列機制的 LangChain GoogleGenerativeAIEmbeddings 生成向量
async function generateEmbeddingsWithLangChain(texts) {
    try {
        console.log(`使用隊列機制生成 ${texts.length} 個文字的向量`)
        
        // 批次處理，每次處理 5 個文字塊（減少批次大小以降低 API 壓力）
        const batchSize = 5
        const allVectors = []
        
        console.log(`將分批處理，每批 ${batchSize} 個文字塊`)
        
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize)
            console.log(`正在處理批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(texts.length / batchSize)} (索引 ${i}-${i + batch.length - 1})`)
            
            try {
                // 使用隊列處理批次
                const batchVectors = await embeddingQueue.addTask(batch)
                
                console.log(`批次 ${Math.floor(i / batchSize) + 1} 完成，生成 ${batchVectors.length} 個向量，維度: ${batchVectors[0]?.length}`)
                
                allVectors.push(...batchVectors)
                
                // 在批次之間添加延遲以避免速率限制
                if (i + batchSize < texts.length) {
                    console.log('等待 2 秒以避免 API 速率限制...')
                    await delay(2000)
                }
                
            } catch (batchError) {
                console.error(`批次 ${Math.floor(i / batchSize) + 1} 遇到錯誤:`)
                console.error(`- 錯誤訊息: ${batchError.message}`)
                
                // 由於我們設定為永不放棄，這裡不應該到達
                // 如果到達這裡，說明有嚴重的系統問題
                console.error(`🚨 嚴重錯誤: 隊列系統回報最終失敗，但系統設定為永不放棄`)
                console.error(`🚨 這可能是系統錯誤，請檢查程式碼邏輯`)
                
                // 即使如此，我們仍然不放棄，而是記錄並等待
                console.log(`⏳ 將等待 30 秒後重新嘗試此批次...`)
                await delay(30000)
                
                // 重新嘗試當前批次
                i -= batchSize // 回退索引，重新處理當前批次
                continue
            }
        }

        console.log(`所有批次處理完成，總共生成 ${allVectors.length} 個向量`)
        
        // 統計結果
        const validVectors = allVectors.filter(v => v && Array.isArray(v) && v.length > 0)
        const invalidVectors = allVectors.length - validVectors.length
        
        console.log(`有效向量: ${validVectors.length}, 無效向量: ${invalidVectors}`)
        
        if (validVectors.length > 0) {
            console.log(`成功生成向量，數量: ${allVectors.length}，維度: ${validVectors[0].length}`)
        } else {
            console.warn('警告: 沒有生成任何有效向量')
        }

        // 如果有太多無效向量，發出警告
        if (invalidVectors > allVectors.length * 0.5) {
            console.warn(`警告: 超過50%的向量生成失敗 (${invalidVectors}/${allVectors.length})`)
        }

        return allVectors
        
    } catch (error) {
        console.error('向量生成過程發生錯誤:', error)
        throw new Error(`向量生成失敗: ${error.message}`)
    }
}


// 輔助函數：逐頁提取文字
async function extractTextByPage(buffer) {
    const { numpages } = await pdf(buffer); // 第一次呼叫僅為獲取總頁數
    if (numpages === 0) return [];

    const pageTexts = [];
    let previousText = '';

    // 透過迭代和比較每次新增的文字來分離出每一頁的內容
    for (let i = 1; i <= numpages; i++) {
        // pdf-parse 的 'max' 選項會處理從第1頁到第 'max' 頁的內容
        const data = await pdf(buffer, { max: i });
        const currentText = data.text;
        // 當前頁的文字 = (到目前頁為止的總文字) - (到上一頁為止的總文字)
        const pageText = currentText.substring(previousText.length);
        pageTexts.push(pageText);
        previousText = currentText;
    }
    return pageTexts;
}

module.exports = {
    extractTextFromPDF,
    generateEmbeddingsWithLangChain,
    extractTextByPage,
    embeddingQueue // 導出隊列實例以便外部監控
}
