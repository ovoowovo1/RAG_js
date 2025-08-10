import React, { useState } from 'react';
import { Modal, Button, message, Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import axios from 'axios';

import { API_BASE_URL } from '../config.js';

const { Dragger } = Upload;

const UploadModal = ({ visible, onCancel, onSuccess }) => {
  const [fileList, setFileList] = useState([]);
  const [uploading, setUploading] = useState(false);

  const handleUpload = () => {
    if (fileList.length === 0) {
      message.warning('請選擇要上傳的文件');
      return;
    }

    setUploading(true);

    const uploadPromises = fileList.map(file => {
      const formData = new FormData();
      formData.append('files', file.originFileObj || file);

      return axios.post(`${API_BASE_URL}/upload-multiple`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
    });

    Promise.all(uploadPromises)
      .then((responses) => {
        setFileList([]);
        message.success(`${fileList.length} 個檔案全部上傳成功。`);
        console.log('上傳成功:', responses.map(r => r.data));
        onSuccess && onSuccess();
        onCancel(); 
      })
      .catch((error) => {
        console.error("Upload error:", error);
        const errorMessage = error.response?.data?.error || error.message || '檔案上傳失敗';
        message.error(`上傳失敗: ${errorMessage}`);
      })
      .finally(() => {
        setUploading(false);
      });
  };

  const handleCancel = () => {
    setFileList([]);
    onCancel();
  };

  const props = {
    multiple: true,
    onRemove: (file) => {
      const newFileList = fileList.filter(item => item.uid !== file.uid);
      setFileList(newFileList);
    },
    beforeUpload: (file, newFiles) => {
      const allFiles = [...fileList, ...newFiles];
      const pdfFiles = allFiles.filter(f => {
        const isPdf = f.type === 'application/pdf';
        if (!isPdf) {
          message.error(`${f.name} 不是一個 PDF 檔案，已自動移除。`);
        }
        return isPdf;
      });

      const uniqueFiles = Array.from(new Map(pdfFiles.map(f => [f.uid, f])).values());
      setFileList(uniqueFiles);
      return false;
    },
    fileList,
  };

  return (
    <Modal
      title="上傳 PDF 文件"
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          取消
        </Button>,
        <Button
          key="upload"
          type="primary"
          onClick={handleUpload}
          disabled={fileList.length === 0}
          loading={uploading}
        >
          {uploading ? '上傳中...' : `確認上傳 ${fileList.length} 個檔案`}
        </Button>
      ]}
      width={600}
      destroyOnClose
    >
      <Dragger 
        {...props}
        style={{ 
          border: '2px dashed #d9d9d9', 
          borderRadius: '8px',
          padding: '40px 20px',
          background: '#fafafa'
        }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: '#7c3aed', fontSize: '48px' }} />
        </p>
        <p className="ant-upload-text" style={{ fontSize: '18px', color: '#666' }}>
          點擊或拖曳多個 PDF 到這裡
        </p>
        <p className="ant-upload-hint" style={{ color: '#999', marginTop: '8px' }}>
          支援上傳多個 PDF 檔案。選擇檔案後請點擊下方的確認按鈕。
        </p>
      </Dragger>
    </Modal>
  );
};

export default UploadModal;
