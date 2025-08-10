const neo4j = require('neo4j-driver');
require('dotenv').config();

// 從環境變數讀取您的 Neo4j AuraDB 憑證
const uri = process.env.NEO4J_URI;
const user = process.env.NEO4J_USERNAME;
const password = process.env.NEO4J_PASSWORD;

if (!uri || !user || !password) {
    throw new Error('請在 .env 檔案中設定 NEO4J_URI, NEO4J_USERNAME, 和 NEO4J_PASSWORD');
}

// 建立一個單例的 driver 實例，供整個應用程式使用
const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));


process.on('exit', async () => {
    await driver.close();
});

module.exports = driver;