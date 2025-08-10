const express = require('express');
const router = express.Router();

const { getFilesList, deleteFile, getSpecificFile } = require('../services/neo4jService');

// 獲取檔案清單
router.get('/files', async (req, res) => {
    try {
        const files = await getFilesList();
        res.json({
            message: '檔案清單獲取成功',
            files: files,
            total: files.length
        });
    } catch (error) {
        console.error('獲取檔案清單錯誤:', error);
        res.status(500).json({
            error: '獲取檔案清單失敗',
            details: error.message
        });
    }
});

// 刪除檔案
router.delete('/files/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        console.log('請求刪除檔案 ID:', fileId);

        const result = await deleteFile(fileId);

        res.json({
            message: result.message,
            success: true,
            deletedFile: result.deletedFile
        });

    } catch (error) {
        console.error('刪除檔案錯誤:', error);

        if (error.message === '檔案不存在') {
            res.status(404).json({
                error: '檔案不存在',
                details: error.message
            });
        } else {
            res.status(500).json({
                error: '刪除檔案失敗',
                details: error.message
            });
        }
    }
});

// 獲取特定檔案詳情 
router.get('/files/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        console.log('請求獲取檔案 ID:', fileId);


        const fileDetails = await getSpecificFile(fileId);

        res.json({
            message: '檔案詳細資訊獲取成功',
            file: fileDetails.file,
            chunks: fileDetails.chunks
        });
    } catch (error) {
        console.error('獲取檔案詳細資訊錯誤:', error);
        if (error.message === '檔案不存在') {
            res.status(404).json({
                error: '檔案不存在',
                details: error.message
            });
        } else {
            res.status(500).json({
                error: '獲取檔案詳細資訊失敗',
                details: error.message
            });
        }
    }
});

module.exports = router;