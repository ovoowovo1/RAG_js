import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhTW from 'antd/locale/zh_TW';

// 導入組件
import DocumentsPage from './pages/DocumentsPage';

// 主應用程式組件
export default function App() {
  return (
    <ConfigProvider locale={zhTW}>
      <Router>
        <div className='h-screen flex flex-col'>
          <Routes>
            <Route path="/" element={<DocumentsPage />} />
          </Routes>
        </div>
      </Router>
    </ConfigProvider>
  );
}
