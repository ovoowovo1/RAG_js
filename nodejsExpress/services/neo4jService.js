const driver = require('../config/neo4jDriver');
const neo4j = require('neo4j-driver');

/**
 * 建立向量索引 (如果不存在)
 * 應用程式啟動時應該執行一次
 */
async function setupVectorIndex() {
    const session = driver.session();
    try {
        console.log('[Neo4j] 正在檢查/建立向量索引...');
        // 這個 Cypher 查詢會建立一個名為 'chunk_embeddings' 的向量索引
        // 它作用於所有 :Chunk 節點的 embedding 屬性
        await session.run(`
            CREATE VECTOR INDEX chunk_embeddings IF NOT EXISTS
            FOR (c:Chunk) ON (c.embedding)
            OPTIONS { indexConfig: {
                \`vector.dimensions\`: 3072,
                \`vector.similarity_function\`: 'cosine'
            }}
        `);
        console.log('[Neo4j] 向量索引已準備就緒。');
    } catch (error) {
        console.error('[Neo4j] 建立向量索引失敗:', error);
    } finally {
        await session.close();
    }

    setupFullTextIndex();
}

async function setupFullTextIndex() {
    const session = driver.session();
    try {
        console.log('[Neo4j] 正在檢查/建立全文檢索索引...');
        // 將 ON (c.text) 修改為 ON EACH [c.text]
        await session.run(`
                     CREATE FULLTEXT INDEX chunk_text_index IF NOT EXISTS
                     FOR (c:Chunk) ON EACH [c.text]
                 `);
        console.log('[Neo4j] 全文檢索索引已準備就緒。');
    } catch (error) {
        console.error('[Neo4j] 建立全文檢索索引失敗:', error);
    } finally {
        await session.close();
    }
}

/**
 * 根據檔案的 hash 查找文件節點
 */
async function findDocumentByHash(hash) {
    const session = driver.session();
    try {
        const result = await session.run(
            'MATCH (d:Document {hash: $hash}) RETURN d.id AS id',
            { hash }
        );
        if (result.records.length > 0) {
            return { id: result.records[0].get('id') };
        }
        return null;
    } finally {
        await session.close();
    }
}

/**
 * 接收文件和帶有實體的塊，並在單一事務中建立完整的圖譜。
 */
async function createGraphFromDocument(document, chunksWithGraph) {
    const session = driver.session();
    try {
        const result = await session.executeWrite(async tx => {

            // --- 步驟一：建立所有節點和基礎關係 ---
            const createNodesQuery = `
                // 1. 建立 Document 節點
                MERGE (d:Document {hash: $document.hash})
                ON CREATE SET d.name = $document.name, d.size = $document.size, d.mimetype = $document.mimetype, d.createdAt = timestamp(), d.id = randomUUID()

                // 2. 使用 UNWIND 批次處理所有 chunks
                WITH d
                UNWIND $chunks AS chunkData

                // 3. 建立 :Chunk 節點並與 Document 建立關係
                CREATE (c:Chunk {
                    text: chunkData.text,
                    pageNumber: chunkData.metadata.pageNumber,
                    embedding: chunkData.embedding,
                    id: randomUUID()
                })
                CREATE (d)-[:HAS_CHUNK]->(c)

                // 4. 為每個 chunk 建立其提及的實體節點
                //  核心修正點：在這裡把 d 也一起傳下去 
                WITH d, c, chunkData.entities AS entities
                UNWIND entities AS entityData
                
                CALL apoc.merge.node([entityData.type], {name: entityData.name}) YIELD node AS e
                MERGE (c)-[:MENTIONS]->(e)

                // 因為 d 在每一步都被正確傳遞了，所以這裡可以安全地使用它
                WITH DISTINCT d
                RETURN d.id AS fileId
            `;

            const nodesResult = await tx.run(createNodesQuery, { document, chunks: chunksWithGraph });

            // 處理文件本身沒有任何 chunk 的邊界情況
            if (nodesResult.records.length === 0) {
                const fallbackResult = await tx.run('MATCH (d:Document {hash: $hash}) RETURN d.id AS fileId', { hash: document.hash });
                if (fallbackResult.records.length > 0) {
                    return { fileId: fallbackResult.records[0].get('fileId') };
                }
                // 如果連 Document 都沒建立成功，就拋出錯誤
                throw new Error('無法在資料庫中建立或找到文件節點');
            }

            const fileId = nodesResult.records[0].get('fileId');

            // --- 步驟二：建立實體之間的關係 ---
            // 這部分查詢沒有變動，因為它不依賴於第一步的變數
            const createRelsQuery = `
                UNWIND $chunks AS chunkData
                WITH chunkData WHERE size(chunkData.relationships) > 0
                UNWIND chunkData.relationships AS relData

                MATCH (sourceNode {name: relData.source})
                MATCH (targetNode {name: relData.target})

                CALL apoc.merge.relationship(sourceNode, relData.type, {}, {}, targetNode) YIELD rel
                
                RETURN count(rel) AS createdRels
            `;

            await tx.run(createRelsQuery, { chunks: chunksWithGraph });

            return { fileId: fileId };
        });

        return result;

    } catch (error) {
        console.error('[Neo4j] 建立圖譜失敗:', error);
        throw new Error(`無法將圖譜寫入資料庫: ${error.message}`);
    } finally {
        await session.close();
    }
}




async function retrieveGraphContext(queryVector, k = 10, selectedFileIds = []) {
    const session = driver.session();
    console.log(`[Neo4j] Top-k 檢索，k=${k}`);
    try {
        let cypherQuery;
        let params = { k: neo4j.int(k), queryVector, selectedFileIds };


        console.log(`[Neo4j] 正在指定的 ${selectedFileIds.length} 個檔案內進行向量搜尋...`);
        cypherQuery = `
                MATCH (doc:Document)-[:HAS_CHUNK]->(chunk)
                WHERE doc.id IN $selectedFileIds

                WITH doc, chunk, vector.similarity.cosine($queryVector, chunk.embedding) AS score

                ORDER BY score DESC
                LIMIT $k

                OPTIONAL MATCH (chunk)-[:MENTIONS]->(entity)
                
                RETURN chunk.text AS text , score, doc.name AS source, doc.id AS fileId, chunk.pageNumber AS page, chunk.id AS chunkId, 
                       collect(CASE WHEN entity IS NOT NULL THEN {name: entity.name, type: labels(entity)[0]} ELSE null END) AS mentionedEntities
                ORDER BY score DESC
            `;



        const result = await session.run(cypherQuery, params);

        console.log(`[Neo4j] 檢索到 ${result.records.length} 條相關上下文`);

        return result.records.map(record => ({
            text: record.get('text'),
            score: record.get('score'),
            source: record.get('source'),
            page: record.get('page'),
            fileId: record.get('fileId'),     // <-- 傳回 fileId
            chunkId: record.get('chunkId'),   // <-- 傳回 chunkId
            mentionedEntities: record.get('mentionedEntities').filter(e => e)
        }));
    } catch (error) {
        console.error('[Neo4j] 檢索圖譜上下文失敗:', error);
        throw error;
    } finally {
        await session.close();
    }
}



 //根據實體列表檢索上下文
async function retrieveContextByEntities(entityNames, selectedFileIds = []) {
    if (!entityNames || entityNames.length === 0) {
        return [];
    }

    const session = driver.session();
    try {
        console.log(`[Neo4j] 正在根據實體 [${entityNames.join(', ')}] 檢索上下文...`);

        // Cypher 查詢已升級，現在會：
        // 1. 在 MATCH 後加上 WHERE 子句，如果 selectedFileIds 陣列不為空，則只搜尋指定的文件。
        // 2. 在 RETURN 中同時回傳 doc.id AS fileId 和 chunk.id AS chunkId。
        const cypherQuery = `
            WITH [name IN $entityNames | toLower(name)] AS lowerCaseNames
            MATCH (entity) WHERE toLower(entity.name) IN lowerCaseNames
            MATCH (doc:Document)-[:HAS_CHUNK]->(chunk:Chunk)-[:MENTIONS]->(entity)

            // 如果 selectedFileIds 為空，此 WHERE 條件會被忽略
            WHERE size($selectedFileIds) = 0 OR doc.id IN $selectedFileIds

            WITH doc, chunk, collect(DISTINCT entity) AS mentionedQueryEntities
            
            RETURN
                chunk.text AS text,
                size(mentionedQueryEntities) AS score, 
                doc.name AS source,
                doc.id AS fileId,        // <-- 核心修正 1
                chunk.pageNumber AS page,
                chunk.id AS chunkId,     // <-- 核心修正 2
                [e IN mentionedQueryEntities | {name: e.name, type: labels(e)[0]}] AS mentionedEntities
            ORDER BY page
        `;
        const result = await session.run(cypherQuery, { entityNames, selectedFileIds }); // <-- 將 selectedFileIds 作為參數傳入

        return result.records.map(record => ({
            text: record.get('text'),
            score: record.get('score'),
            source: record.get('source'),
            page: record.get('page'),
            fileId: record.get('fileId'),       // <-- 傳回 fileId
            chunkId: record.get('chunkId'),     // <-- 傳回 chunkId
            mentionedEntities: record.get('mentionedEntities')
        }));
    } catch (error) {
        console.error(`[Neo4j] 根據實體列表檢索上下文失敗:`, error);
        throw error;
    } finally {
        await session.close();
    }
}


async function retrieveContextByKeywords(keywords, selectedFileIds = [] , k = 10) {
    const session = driver.session();
    const kInt = neo4j.int(k);
    try {
        // 使用全文檢索索引進行查詢
        const cypherQuery = `
            CALL db.index.fulltext.queryNodes("chunk_text_index", $keywords) YIELD node AS chunk, score
            MATCH (doc:Document)-[:HAS_CHUNK]->(chunk)
            WHERE size($selectedFileIds) = 0 OR doc.id IN $selectedFileIds

            OPTIONAL MATCH (chunk)-[:MENTIONS]->(entity)
            
            RETURN
                chunk.text AS text,
                score, // 全文檢索會回傳自己的相關性分數
                doc.name AS source,
                doc.id AS fileId,
                chunk.pageNumber AS page,
                chunk.id AS chunkId,
                collect(CASE WHEN entity IS NOT NULL THEN {name: entity.name, type: labels(entity)[0]} ELSE null END) AS mentionedEntities
            ORDER BY score DESC
            LIMIT $kInt // 限制回傳數量
        `;
        const result = await session.run(cypherQuery, { keywords, selectedFileIds, kInt });

        return result.records.map(record => ({
            text: record.get('text'),
            score: record.get('score'),
            source: record.get('source'),
            page: record.get('page'),
            fileId: record.get('fileId'),
            chunkId: record.get('chunkId'),
            mentionedEntities: record.get('mentionedEntities').filter(e => e)
        }));

    } finally {
        await session.close();
    }
}





/**
 * 獲取所有 Document 節點的列表
 */
async function getFilesList() {
    const session = driver.session();
    try {
        console.log('[Neo4j] 正在獲取格式化後的檔案列表...');


        const result = await session.run(`
            MATCH (d:Document)
            WHERE d.id IS NOT NULL AND d.hash IS NOT NULL
            WITH d
            ORDER BY d.createdAt DESC
            RETURN 
                d.id AS id,
                d.name AS name,
                d.size AS size,
                d.mimetype AS mime_type,
                d.createdAt AS upload_date,
                COUNT {(d)-[:HAS_CHUNK]->()} AS total_chunks
        `);

        // 將 Neo4j 回傳的 records 轉換為目標 "Neon" 格式
        return result.records.map(record => {
            const createdAt = record.get('upload_date');

            return {
                id: record.get('id'),
                filename: record.get('name'),
                original_name: record.get('name'),
                file_size: record.get('size'),
                mime_type: record.get('mime_type'),
                upload_date: createdAt ? createdAt.toString() : null,
                status: "completed",
                total_chunks: record.get('total_chunks').toNumber()
            };
        });
    } catch (error) {
        console.error('[Neo4j] 獲取格式化檔案列表失敗:', error);
        throw error;
    } finally {
        await session.close();
    }
}

/**
 * 根據 ID 刪除一個 Document 節點及其所有相關的 Chunk 節點
 */
async function deleteFile(fileId) {
    const session = driver.session();
    try {
        console.log(`[Neo4j] 準備刪除檔案 ID: ${fileId}`);
        const tx = session.beginTransaction();

        // 步驟 1: 在刪除前，先找到這個檔案的資訊，以便回傳給前端
        const fileInfoResult = await tx.run(
            'MATCH (d:Document {id: $fileId}) RETURN d',
            { fileId }
        );

        if (fileInfoResult.records.length === 0) {
            throw new Error('檔案不存在');
        }
        const deletedFile = fileInfoResult.records[0].get('d').properties;

        // 步驟 2: 刪除 Document 節點以及所有與它有 :HAS_CHUNK 關係的 Chunk 節點
        // DETACH DELETE 會刪除節點以及與其相連的所有關係，確保資料庫的乾淨
        await tx.run(
            `MATCH (d:Document {id: $fileId})
             DETACH DELETE d`,
            { fileId }
        );

        await tx.commit();
        console.log(`[Neo4j] 已成功刪除檔案: ${deletedFile.name} (ID: ${fileId})`);

        return {
            message: `檔案 '${deletedFile.name}' 已成功從資料庫刪除。`,
            deletedFile: { id: deletedFile.id, name: deletedFile.name }
        };
    } catch (error) {
        console.error(`[Neo4j] 刪除檔案 ${fileId} 失敗:`, error);
        throw error;
    } finally {
        await session.close();
    }
}


async function getSpecificFile(fileId) {
    const session = driver.session();
    try {
        console.log(`[Neo4j] 正在獲取檔案詳情 ID: ${fileId}`);


        const result = await session.run(`
            MATCH (d:Document {id: $fileId})
            OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:Chunk)
            WHERE d.id IS NOT NULL AND d.hash IS NOT NULL
            WITH d, c 
            ORDER BY c.pageNumber ASC
            RETURN d, collect({
                id: c.id,
                content: c.text,
                pageNumber: c.pageNumber
            }) AS chunks
        `, { fileId });

        if (result.records.length === 0 || !result.records[0].get('d')) {
            throw new Error('檔案不存在');
        }

        const record = result.records[0];
        const fileNode = record.get('d').properties;
        const rawChunks = record.get('chunks').filter(c => c.id); // 過濾掉沒有 chunk 時產生的空物件

        // 格式化 'file' 物件以符合 Neon 標準
        const formattedFile = {
            id: fileNode.id,
            filename: fileNode.name,
            original_name: fileNode.name,
            file_size: fileNode.size.toString(),
            mime_type: fileNode.mimetype,
            upload_date: fileNode.createdAt ? fileNode.createdAt.toString() : null,
            status: "completed", // 假設能查詢到詳情就是已完成
            total_chunks: rawChunks.length // 直接計算收集到的 chunks 數量
        };

        // 格式化 'chunks' 陣列以符合舊版 databaseService 的輸出
        // 這樣前端就不需要做任何修改
        const formattedChunks = rawChunks.map(chunk => ({
            id: chunk.id,
            content: chunk.content,
            // 為了最大化兼容性，我們用 pageNumber 來對應舊的 chunk_index
            chunk_index: chunk.pageNumber
        }));

        return {
            file: formattedFile,
            chunks: formattedChunks
        };
    } catch (error) {
        console.error(`[Neo4j] 獲取檔案 ${fileId} 詳情失敗:`, error);
        throw error;
    } finally {
        await session.close();
    }
}




module.exports = {
    setupVectorIndex,
    findDocumentByHash,
    createGraphFromDocument,
    retrieveGraphContext,
    retrieveContextByEntities,
    retrieveContextByKeywords,

    getFilesList,
    deleteFile,
    getSpecificFile
};