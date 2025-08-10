// --- START OF FILE DocumentContentViewer.jsx (FIXED) ---

import React, { useEffect } from 'react';
import { Spin } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { fetchDocumentContent } from '../redux/documentSlice';
import LazyLoadChunk from './LazyLoadChunk';

const DocumentContentViewer = ({
    selectedShowDocumentContentID
}) => {
    const dispatch = useDispatch();


    const { documentData, isLoading } = useSelector((state) => ({
        documentData: state.documents?.documentsById[selectedShowDocumentContentID],
        isLoading: state.documents?.contentLoading,
    }));


    useEffect(() => {
        if (selectedShowDocumentContentID && !documentData && !isLoading) {
            dispatch(fetchDocumentContent(selectedShowDocumentContentID));
        }
    }, [selectedShowDocumentContentID, documentData, isLoading, dispatch]);

    return (
        // 當有 ID 被選中時，顯示此區塊
        <div className={`${selectedShowDocumentContentID ? 'flex flex-col flex-1 h-0' : 'hidden'}`}>


            {isLoading && !documentData ? (
                <div className="flex justify-center items-center flex-1">
                    <Spin />
                </div>


            ) : documentData ? (
                <div className="flex flex-col flex-1 h-full">
                    <h4 className="mb-2 flex-shrink-0">文件內容</h4>
                    <div className="overflow-y-auto flex-1 h-0">
                        {documentData.chunks.map((chunk, index) => (
                            <LazyLoadChunk key={index} chunk={chunk} />
                        ))}
                    </div>
                </div>

            ) : selectedShowDocumentContentID ? (
                <div className="flex justify-center items-center flex-1">
                    <Spin />
                </div>
            ) : null}
        </div>
    );
};

export default DocumentContentViewer;