import React, { useState, useEffect, useRef } from 'react';
import { Popover, Spin } from 'antd';
import { useDispatch, useSelector } from 'react-redux';
import { fetchDocumentContent } from '../redux/documentSlice';

export default function Citation({ part, index }) {
    const dispatch = useDispatch();
    const { fileId: selectedShowDocumentContentID, chunkId: citationId } = part.details;

    // 從 Redux store 中，根據 ID 選擇特定的文件資料和其載入狀態
    const { documentData, isLoading } = useSelector((state) => ({
        documentData: state.documents?.documentsById[selectedShowDocumentContentID],
        isLoading: state.documents?.contentLoading,
    }));

    const markedChunkRef = useRef(null);
    const [popoverVisible, setPopoverVisible] = useState(false);

    useEffect(() => {
        if (popoverVisible && !documentData && !isLoading) {
 
            if (selectedShowDocumentContentID) {
                dispatch(fetchDocumentContent(selectedShowDocumentContentID));
            }
        }
    }, [popoverVisible, documentData, isLoading, dispatch, selectedShowDocumentContentID]);

    useEffect(() => {

        if (popoverVisible && documentData && markedChunkRef.current) {
            setTimeout(() => {
                markedChunkRef.current.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });
            }, 50); 
        }
    }, [popoverVisible, documentData]);

    const popoverContent = (
        <div className="max-w-xs max-h-96 overflow-y-auto">
            <p><strong>來源:</strong> {part.details.source}</p>
            <p><strong>頁碼:</strong> {part.details.page}</p>
            <hr className="my-2" />
            {isLoading ? (
                <div className="flex justify-center items-center p-4">
                    <Spin />
                </div>
            ) : documentData ? (
                documentData.chunks.map((chunk) => (
                    <span
                        datatype={chunk.id}
                        key={chunk.id}
                        ref={String(chunk.id) === String(citationId) ? markedChunkRef : null}
                    >
                        {
                            String(chunk.id) === String(citationId) ? (
                                <pre className='whitespace-pre-wrap break-words'><mark>{chunk.content}</mark></pre>
                            ) : (
                                <pre className='whitespace-pre-wrap break-words'>{chunk.content}</pre>
                            )
                        }
                    </span>
                ))
            ) : (
                <p><Spin /></p>
            )}
        </div>
    );

    return (
        <Popover
            content={popoverContent}
            title="引用來源"
            trigger="click"
            key={index}
            open={popoverVisible} 
            onOpenChange={(visible) => setPopoverVisible(visible)}
        >
            <sup className="text-blue-500 font-bold cursor-pointer mx-0.5 py-px px-1.5 bg-blue-50 rounded">
                [{part.number}]
            </sup>
        </Popover>
    );
}