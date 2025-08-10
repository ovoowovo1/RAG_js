const express = require('express')
const router = express.Router()
const { processAndCreateGraph } = require('../services/graphDocumentService');


// 處理多檔案上傳
router.post('/upload-multiple', async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ error: '沒有檔案被上傳' });
        }

        let files = req.files.files;
        if (!Array.isArray(files)) {
            files = [files];
        }

        const uploadPromises = files.map(file => {
            return processAndCreateGraph(file)
                .catch(error => {
                    console.error(`處理檔案 ${file.name} 時發生嚴重錯誤:`, error);
                    return { error: true, originalname: file.name, message: error.message };
                });
        });

        const results = await Promise.all(uploadPromises);

        res.json({
            message: `處理完成 ${results.length} 個檔案。`,
            results: results
        });

    } catch (error) {
        console.error('檔案上傳處理流程錯誤:', error);
        res.status(500).json({
            error: '伺服器內部錯誤',
            details: error.message
        });
    }
});



module.exports = router
