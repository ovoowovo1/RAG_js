import React, { useState, useRef, useLayoutEffect } from 'react';
import { useInView } from 'react-intersection-observer';

const LazyLoadChunk = ({ chunk }) => {
    const { ref, inView } = useInView({
        triggerOnce: true,
        rootMargin: '200px 0px',
    });

    const [height, setHeight] = useState('auto');
    const contentRef = useRef(null);

    useLayoutEffect(() => {
        if (inView) return;
        if (contentRef.current && height === 'auto') {
            setHeight(contentRef.current.offsetHeight);
        }
    }, [inView, height]);

    return (
        <div ref={ref} style={{ height: !inView ? height : 'auto' }}>
            {inView ? (
                <pre className='whitespace-pre-wrap break-words'>{chunk.content}</pre>
            ) : (
                <pre
                    ref={contentRef}
                    className='whitespace-pre-wrap break-words'
                    style={{
                        opacity: 0,
                        position: 'absolute',
                        zIndex: -1,
                        pointerEvents: 'none'
                    }}
                >
                    {chunk.content}
                </pre>
            )}
        </div>
    );
};

export default LazyLoadChunk;
