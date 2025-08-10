import { configureStore } from '@reduxjs/toolkit';
import documentsReducer from './documentSlice';

export const store = configureStore({
    reducer: {
        documents: documentsReducer,
    },
});
