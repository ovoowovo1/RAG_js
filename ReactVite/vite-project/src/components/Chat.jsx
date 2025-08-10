import React, { useCallback, useMemo, useState, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useSelector } from 'react-redux';
import { Card, Button, Spin, message, Switch, Tooltip, Space, Typography } from 'antd';
import { UserOutlined, ReloadOutlined, CopyOutlined, ClearOutlined } from '@ant-design/icons';
import { handleProChatRequest, handleProChatRequestWithProgress, generateWelcomeMessage } from '../utils/proChatHelpers.jsx';
import useMediaQuery from '../hooks/useMediaQuery';
import Citation from '../components/Citation.jsx';
import RetrievalProgress from '../components/RetrievalProgress.jsx';
import { Bubble, Sender } from '@ant-design/x';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
});

const renderMessageContent = (content) => {
    if (typeof content === 'string') {
        const renderedContent = md.render(content);
        return <div dangerouslySetInnerHTML={{ __html: renderedContent }} className="prose max-w-none markdown-content leading-relaxed text-sm" />;
    }
    if (Array.isArray(content)) {
        return (
            <div className="prose max-w-none markdown-content leading-relaxed text-sm">
                {content.map((part, index) => {
                    if (part.type === 'text') {
                        let renderedHtml = md.render(part.value);
                        if (renderedHtml.startsWith('<p>') && renderedHtml.endsWith('</p>\n') && (renderedHtml.match(/<p>/g) || []).length === 1) {
                            renderedHtml = renderedHtml.slice(3, renderedHtml.length - 5);
                        }
                        return <span key={index} dangerouslySetInnerHTML={{ __html: renderedHtml }} />;
                    }
                    if (part.type === 'citation') {
                        return <Citation key={index} part={part} index={index} />;
                    }
                    return null;
                })}
            </div>
        );
    }
    return <div>{String(content)}</div>;
};

export default function Chat({ widthSize = null }) {
    const { items: documents, selectedFileIds } = useSelector((state) => state.documents);
    const filteredDocuments = useMemo(() => documents, [documents]);

    const [content, setContent] = useState('');
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [enableProgress, setEnableProgress] = useState(true);
    const [progressMessages, setProgressMessages] = useState([]);

    const handleClearChat = useCallback(() => {
        setMessages([]);
        setContent('');
        setProgressMessages([]);
    }, []);

    const handleCopy = useCallback((messageContent) => {
        console.log('handleCopy called with:', typeof messageContent, messageContent);
        let textToCopy = '';

        if (typeof messageContent === 'string') {
            textToCopy = messageContent;
        } else if (Array.isArray(messageContent)) {
            textToCopy = messageContent
                .filter(p => p && p.type === 'text')
                .map(p => p.value)
                .join('\n');
        } else if (messageContent && typeof messageContent === 'object') {
            // 如果是物件，嘗試提取文字內容
            if (messageContent.content) {
                textToCopy = messageContent.content;
            } else if (messageContent.value) {
                textToCopy = messageContent.value;
            } else {
                textToCopy = JSON.stringify(messageContent);
            }
        } else {
            textToCopy = String(messageContent || '');
        }

        console.log('Copying text:', textToCopy);

        if (!textToCopy.trim()) {
            message.warning('沒有可複製的內容');
            return;
        }

        navigator.clipboard.writeText(textToCopy)
            .then(() => message.success('已複製到剪貼簿'))
            .catch(() => message.error('複製失敗'));
    }, []);

    const handleResend = useCallback((messageContent) => {
        const msgToResend = messages.find(msg => msg.message === messageContent && msg.status === 'local');
        if (msgToResend) {
            handleChatRequest(msgToResend.message);
        }
    }, [messages]);

    const roles = useMemo(() => ({
        ai: {
            placement: 'start',
            avatar: { icon: <UserOutlined />, style: { background: '#fde3cf' } },
            style: { width: '80%' },
        },
        local: {
            placement: 'end',
            avatar: { icon: <UserOutlined />, style: { background: '#87d068' } },
        },
    }), []);

    const handleChatRequest = useCallback((userMessage) => {
        if (!userMessage.trim()) return;

        setIsLoading(true);
        setProgressMessages([]);

        const userMessageObj = { id: `user-${Date.now()}`, message: userMessage, status: 'local' };
        const loadingMessageObj = { id: `loading-${Date.now()}`, message: '正在處理您的查詢...', status: 'loading' };

        flushSync(() => {
            setMessages(prev => [...prev, userMessageObj, loadingMessageObj]);
        });

        const messagesForAPI = [{ content: userMessage }];
        const requestOptions = {
            requestBody: {
                selectedFileIds: selectedFileIds.length > 0 ? selectedFileIds : undefined,
                documentCount: filteredDocuments.length,
                selectedCount: selectedFileIds.length,
            },
        };

        const handleSuccess = async (response) => {
            const responseText = await response.text();
            let responseContent;
            try { responseContent = JSON.parse(responseText); } catch (e) { responseContent = responseText; }
            setMessages(prev => [
                ...prev.filter(msg => msg.status !== 'loading'),
                { id: `ai-${Date.now()}`, message: responseContent, status: 'ai' },
            ]);
        };

        const handleError = (error) => {
            console.error('聊天請求錯誤:', error);
            setMessages(prev => [
                ...prev.filter(msg => msg.status !== 'loading'),
                { id: `ai-error-${Date.now()}`, message: '抱歉，發生了錯誤，請稍後再試。', status: 'ai' },
            ]);
        };

        const apiCall = enableProgress
            ? handleProChatRequestWithProgress(messagesForAPI, {
                ...requestOptions,
                onProgress: (progressEvent) => {
                    setProgressMessages(prev => [...prev, progressEvent]);
                },
            })
            : handleProChatRequest(messagesForAPI, requestOptions);

        apiCall.then(handleSuccess).catch(handleError).finally(() => {
            setIsLoading(false);
        });

    }, [selectedFileIds, filteredDocuments, enableProgress, messages]);

    return (
        <Card hoverable className={`h-full flex flex-col`} style={{ width: widthSize || '100%' }} styles={{ body: { height: '100%', padding: 0, display: 'flex', flexDirection: 'column' } }}>
            <div className="flex flex-col h-full gap-4">
                <div className="flex-1 overflow-y-auto p-4">
                    {messages.length === 0 ? (
                        <Bubble content={generateWelcomeMessage(filteredDocuments.length, selectedFileIds.length)} placement="start" variant="outlined" avatar={{ icon: <UserOutlined />, style: { background: '#fde3cf' } }} />
                    ) : (
                        <Bubble.List
                            roles={roles}
                            items={messages.map(({ id, message, status }, index) => {
   
                                let finalContent;

                                if (status === 'loading' && enableProgress) {
      
                                    finalContent = (
                                        <div className='w-full'>
                                            <RetrievalProgress progressMessages={progressMessages} />
                                            <div className="flex items-center gap-2 mt-2">
                                                <Spin size="small" />
                                                <span>{message}</span>
                                            </div>
                                        </div>
                                    );
                                } else if (status === 'ai') {
                                    const isLastMessage = index === messages.length - 1;

                                    if (isLastMessage && enableProgress && progressMessages.length > 0) {
                                        finalContent = (
                                            <div className='w-full'>
                                                <RetrievalProgress progressMessages={progressMessages} />
                                                {renderMessageContent(message)}
                                            </div>
                                        );
                                    } else {
                                        finalContent = renderMessageContent(message);
                                    }
                                } else { 
                                    finalContent = message;
                                }

                                return {
                                    variant: "outlined",
                                    key: id,
                                   
                                    styles: {
                                        content: { width: status === 'local' ? '' : '100%' }
                                    },
                               
                                    footer: status === 'loading' ? null : (
                                        status === 'local' ? (
                                            <div className='flex gap-2'>
                                                <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => handleResend(message)} title="重新發送" />
                                                <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(message)} title="複製訊息" />
                                            </div>
                                        ) : (
                                            <div className='flex gap-2'>
                                                <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => handleCopy(message)} title="複製回應" />
                                            </div>
                                        )
                                    ),
                                      // 我們不再傳遞 loading: true，而是自己控制內容
                                    role: status === 'local' ? 'local' : 'ai',
                                    content: finalContent,
                                    'data-original-message': JSON.stringify(message),
                                };
                            })}
                        />
                    )}
                </div>
                <div className="p-4 border-t border-gray-200">
                    <div className="flex gap-2 items-center mb-2">
                        <Tooltip title="啟用時會顯示檢索進度">
                            <div className="flex items-center gap-2">
                                <Switch size="small" checked={enableProgress} onChange={setEnableProgress} />
                                <span className="text-xs text-gray-500">進度顯示</span>
                            </div>
                        </Tooltip>
                    </div>
                    <div className="flex gap-2 items-center">
                        <div className="flex-1">
                            <Sender

                                loading={isLoading}
                                value={content}
                                onChange={setContent}
                                allowSpeech
                                onSubmit={nextContent => { handleChatRequest(nextContent); setContent(''); }}
                                placeholder='請輸入問題...'
                                actions={(_, info) => {
                                    const { SendButton, LoadingButton, ClearButton, SpeechButton } = info.components;
                                    return (
                                        <>
                                            <Space size="small">
                                                <Typography.Text type="secondary">
                                                    <small>`Enter` to submit</small>
                                                </Typography.Text>
                                                { messages.length > 0 && <Button type="text" icon={<ClearOutlined />} onClick={handleClearChat} title="清空對話" className="flex-shrink-0" /> }
                                                <SpeechButton />
                                                {isLoading ? (
                                                    <LoadingButton type="default" icon={<Spin size="small" />} disabled />
                                                ) : (
                                                    <SendButton type="primary" disabled={false} />
                                                )}
                                            </Space>

                                        </>
                                    )
                                }}

                            />
                        </div>

                    </div>
                </div>
            </div>
        </Card>
    );
}