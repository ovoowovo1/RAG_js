import React, { useState } from 'react';
import { Tabs } from 'antd';
import { motion, AnimatePresence } from 'framer-motion';

const contentVariants = {
    hidden: {
        opacity: 0,
        y: 20,
        transition: { duration: 0.3, ease: "easeInOut" }
    },
    visible: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.3, ease: "easeInOut" }
    },
    exit: {
        opacity: 0,
        y: -20,
        transition: { duration: 0.3, ease: "easeInOut" }
    }
};

const tabItems = [
    {
        key: '1',
        label: 'Sources',
    },
    {
        key: '2',
        label: 'Chat',
    },
];

export default function DocumentsTabs({ sourcesContent, chatContent }) {
    const [activeTab, setActiveTab] = useState('1');

    const handleTabChange = (key) => {
        setActiveTab(key);
    };

    return (
        <>
            <div className="h-full w-full flex flex-col">

                <Tabs animated={true} centered activeKey={activeTab} onChange={handleTabChange} items={tabItems}
                    className='bg-white shadow-md' />
                <div className="flex-1 overflow-y-auto">
                    <AnimatePresence mode="wait">
                        {activeTab === '1' && (
                            <motion.div
                                key="sources"
                                variants={contentVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                className="h-full w-full p-2"
                            >
                                {sourcesContent}
                            </motion.div>
                        )}
                        {activeTab === '2' && (
                            <motion.div
                                key="chat"
                                variants={contentVariants}
                                initial="hidden"
                                animate="visible"
                                exit="exit"
                                className="h-full w-full p-2"
                            >
                                {chatContent}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </>
    );
}
