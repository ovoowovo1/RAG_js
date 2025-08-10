const express = require('express')
const fileUpload = require('express-fileupload')
const path = require('path')
const fs = require('fs')
const cors = require('cors')
require('dotenv').config()

// 導入路由和服務
const uploadRouter = require('./routes/upload')
const queryStreamRouter = require('./routes/queryStream')
const filesNeo4jRouter = require('./routes/filesNeo4j')


const { setupVectorIndex } = require('./services/neo4jService');

const app = express()
const port = 3000

// 中間件設定
app.use(cors()) // 啟用 CORS
app.use(express.json()) // 解析 JSON 請求體

// 使用 express-fileupload 中間件
app.use(fileUpload({
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB 限制
    abortOnLimit: true, // 超過限制時中止上傳
    responseOnLimit: "檔案大小超過 100MB 限制",
}))

// 初始化資料庫架構
async function startServer() {
    try {
        await setupVectorIndex();
        console.log('neo4j向量索引初始化完成')
    } catch (error) {
        console.error('neo4j向量索引初始化失敗:', error)
        process.exit(1)
    }
}

// 路由設定
app.use('/', uploadRouter)
app.use('/api', queryStreamRouter) 
app.use('/neo4j', filesNeo4jRouter)

// 錯誤處理中間件
app.use((error, req, res, next) => {
    res.status(500).json({ error: error.message })
})


app.get('/', (req, res) => {
    res.send('hello world');
})


// 啟動服務器
startServer().then(() => {
    app.listen(port, () => {
        console.log(`Example app listening on http://localhost:${port}`)
        console.log(`Press Ctrl+C to quit.`)
    })
})
