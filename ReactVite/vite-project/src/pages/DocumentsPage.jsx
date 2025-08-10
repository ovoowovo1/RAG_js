import React from 'react';
import { useSelector } from 'react-redux';

import DocumentList from '../components/DocumentList.jsx';
import DocumentsTabs from '../components/DocumentsTabs.jsx';
import Chat from '../components/Chat.jsx';
import useMediaQuery from '../hooks/useMediaQuery';

const DocumentsPage = () => {
    const {
        selectedShowDocumentContentID,
    } = useSelector((state) => state.documents);
    const isMediumScreen = useMediaQuery('(max-width: 1024px)');


    return (
        <>
            {
                isMediumScreen ? (
                    <div className={`h-screen flex overflow-hidden bg-gray-100 flex-col`}>
                        <DocumentsTabs
                            sourcesContent={< DocumentList />}
                            chatContent={<Chat />}
                        />
                    </div>
                ) : (
                    <div className={`h-screen p-4 flex overflow-hidden gap-4  bg-gray-100 `}>
                        <DocumentList widthSize={selectedShowDocumentContentID != null ? "25%" : "20%"} />
                        <Chat widthSize={selectedShowDocumentContentID != null ? "75%" : "80%"} />
                    </div>
                )}
        </>
    );
};

export default DocumentsPage;