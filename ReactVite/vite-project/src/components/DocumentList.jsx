import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Card, List, Typography, Button, Input, message, Dropdown } from 'antd';
import { ShrinkOutlined, PlusOutlined, DeleteOutlined, MoreOutlined, FileTextOutlined, CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';

import {
    fetchDocuments,
    deleteDocument,
    setSearchTerm,
    setSelectedShowDocumentContentID,
    toggleFileSelection,
    toggleSelectAll,
} from '../redux/documentSlice';

import DocumentContentViewer from './DocumentContentViewer';
import UploadModal from './UploadModal';

const { Title, Text } = Typography;
const { Search } = Input;

export default function DocumentList({ widthSize }) {
    const dispatch = useDispatch();
    const {
        items: documents,
        loading,
        error,
        selectedFileIds,
        selectedShowDocumentContentID,
        searchTerm,
    } = useSelector((state) => state.documents);

    const [hoveredDocId, setHoveredDocId] = useState(null);
    const [dropdownOpen, setDropdownOpen] = useState(null);
    const [uploadModalVisible, setUploadModalVisible] = useState(false);

    useEffect(() => {
        dispatch(fetchDocuments());
    }, [dispatch]);

    useEffect(() => {
        if (error) {
            message.error(error);
        }
    }, [error]);

    const handleDeleteClick = (docId) => {
        dispatch(deleteDocument(docId)).then(() => {
            message.success('文件已刪除');
        });
    };

    const handleFileSelect = (fileId, isSelected) => {
        dispatch(toggleFileSelection(fileId));
    };

    const handleSelectAll = () => {
        const allFileIds = filteredDocuments.map(doc => doc.id);
        dispatch(toggleSelectAll(allFileIds));
    };

    const filteredDocuments = useMemo(() =>
        documents.filter(doc =>
            doc.filename.toLowerCase().includes(searchTerm.toLowerCase())
        ), [documents, searchTerm]);

    const isFileSelected = (docId) => selectedFileIds.includes(docId);

    const selectedAll = useMemo(() =>
        filteredDocuments.length > 0 && selectedFileIds.length === filteredDocuments.length,
        [selectedFileIds, filteredDocuments]
    );

    const items = (docId) => [
        {
            key: '1',
            label: '刪除',
            icon: <DeleteOutlined />,
            onClick: () => handleDeleteClick(docId),
        },
    ];

    const getStatusIcon = (status, docId) => {
        const isHovered = hoveredDocId === docId || dropdownOpen === docId;
        switch (status) {
            case 'processed':
                return <CheckCircleOutlined className="text-green-500 ml-2" />;
            case 'processing':
                return <ClockCircleOutlined className="text-blue-500 ml-2" />;
            case 'failed':
                return <ExclamationCircleOutlined className="text-red-500 ml-2" />;
            default:
                return (
                    <div
                        className="ml-2 rounded"
                        onMouseEnter={() => setHoveredDocId(docId)}
                        onMouseLeave={() => {
                            if (dropdownOpen !== docId) {
                                setHoveredDocId(null);
                            }
                        }}
                    >
                        {isHovered ? (
                            <Dropdown
                                menu={{ items: items(docId) }}
                                placement="bottomLeft"
                                trigger={['click']}
                                open={dropdownOpen === docId}
                                onOpenChange={(open) => {
                                    setDropdownOpen(open ? docId : null);
                                    setHoveredDocId(open ? docId : null);
                                }}
                            >
                                <Button shape="circle" type="text" icon={<MoreOutlined className="text-zinc-500" />} />
                            </Dropdown>
                        ) : (
                            <Button shape="circle" type="text" icon={<FileTextOutlined className="text-zinc-500" />} />
                        )}
                    </div>
                );
        }
    };

    return (
        <Card
            className={`h-full  border-r border-gray-100 flex flex-col transition-all duration-300 ease-in-out`}
            style={{ width: widthSize || '100%' }}
            hoverable
            styles={{ body: { height: '100%', padding: '24px', display: 'flex', flexDirection: 'column' } }}
        >
            <div className="flex mb-4">
                <Title level={4} className="m-0">Sources</Title>
                <Button
                    className={`ml-auto ${selectedShowDocumentContentID ? '' : 'hidden'}`}
                    onClick={() => dispatch(setSelectedShowDocumentContentID(null))}
                    shape='circle'
                    type="text"
                    icon={<ShrinkOutlined />}
                />
            </div>
            <DocumentContentViewer selectedShowDocumentContentID={selectedShowDocumentContentID} />
            {!selectedShowDocumentContentID && (
                <>
                    <Search
                        placeholder="搜尋文件..."
                        value={searchTerm}
                        onChange={(e) => dispatch(setSearchTerm(e.target.value))}
                        className="mb-4"
                        allowClear
                    />
                    <div className="flex items-center text-zinc-300 cursor-pointer py-2">
                        <input
                            type="checkbox"
                            checked={selectedAll}
                            onChange={handleSelectAll}
                            className="mr-2"
                        />
                        <Text className="text-zinc-300">Select all sources</Text>
                        <Button
                            className='ml-auto'
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => setUploadModalVisible(true)}
                        >
                            Add
                        </Button>
                    </div>
                    <div className="border-t border-gray-100 flex-1 overflow-y-auto min-h-0">
                        <List
                            split={false}
                            loading={loading}
                            dataSource={filteredDocuments}
                            renderItem={(doc) => (
                                <List.Item
                                    className={`cursor-pointer hover:bg-gray-50 ${selectedFileIds.includes(doc.id) ? 'bg-blue-50' : ''}`}
                                >
                                    <div className="flex items-center w-full">
                                        <div className="flex items-center">{getStatusIcon(doc.status, doc.id)}</div>
                                        <div className="flex-1 mx-3 flex items-center min-w-0" onClick={(e) => { e.stopPropagation(); dispatch(setSelectedShowDocumentContentID(doc.id)); }}>
                                            <Text className="text-sm truncate">{doc.filename}</Text>
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={isFileSelected(doc.id)}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                handleFileSelect(doc.id, e.target.checked);
                                            }}
                                            className="mr-2"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    </div>
                                </List.Item>
                            )}
                        />
                    </div>
                    <div className="p-4 border-t border-gray-100">
                        <Text className="text-zinc-400 text-xs">
                            {filteredDocuments.length} sources
                            {selectedFileIds.length > 0 && (
                                <span className="ml-2 text-blue-500">({selectedFileIds.length} selected)</span>
                            )}
                        </Text>
                    </div>
                </>
            )}
            <UploadModal
                visible={uploadModalVisible}
                onCancel={() => setUploadModalVisible(false)}
                onSuccess={() => dispatch(fetchDocuments())}
            />
        </Card>
    );
}
