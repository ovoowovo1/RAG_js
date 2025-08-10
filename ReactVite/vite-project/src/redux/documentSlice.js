import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import axios from 'axios';
import { API_BASE_URL } from '../config';

// 異步 Thunk 用於從 API 獲取文件
export const fetchDocuments = createAsyncThunk(
    'documents/fetchDocuments',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axios.get(`${API_BASE_URL}/neo4j/files`);
            return response.data.files || [];
        } catch (error) {
            console.error('Fetch documents error:', error);
            return rejectWithValue('載入文件列表失敗');
        }
    }
);

// 異步 Thunk 用於刪除文件
export const deleteDocument = createAsyncThunk(
    'documents/deleteDocument',
    async (docId, { rejectWithValue }) => {
        try {
            await axios.delete(`${API_BASE_URL}/neo4j/files/${docId}`);
            return docId;
        } catch (error) {
            console.error('Delete document error:', error);
            return rejectWithValue('刪除文件失敗');
        }
    }
);

export const fetchDocumentContent = createAsyncThunk(
    'document/fetchDocumentContent',
    async (docId, { rejectWithValue }) => {
        if (!docId) {
            return null;
        }
        try {
            const response = await axios.get(`${API_BASE_URL}/neo4j/files/${docId}`);
            return response.data;
        } catch (error) {
            return rejectWithValue(error.response.data);
        }
    }
);

const documentsSlice = createSlice({
    name: 'documents',
    initialState: {
        items: [],
        documentsById: {},
        loading: false, // for document list
        contentLoading: false, // for document content viewer
        error: null,
        selectedFileIds: [],
        selectedShowDocumentContentID: null,
        searchTerm: '',
    },
    reducers: {
        setSearchTerm: (state, action) => {
            state.searchTerm = action.payload;
        },
        setSelectedShowDocumentContentID: (state, action) => {
            state.selectedShowDocumentContentID = action.payload;
        },
        toggleFileSelection: (state, action) => {
            const fileId = action.payload;
            const index = state.selectedFileIds.indexOf(fileId);
            if (index >= 0) {
                state.selectedFileIds.splice(index, 1);
            } else {
                state.selectedFileIds.push(fileId);
            }
        },
        toggleSelectAll: (state, action) => {
            const allFileIds = action.payload;
            if (state.selectedFileIds.length === allFileIds.length) {
                state.selectedFileIds = [];
            } else {
                state.selectedFileIds = allFileIds;
            }
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchDocuments.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchDocuments.fulfilled, (state, action) => {
                state.loading = false;
                state.items = action.payload;
            })
            .addCase(fetchDocuments.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
                state.items = [];
            })
            .addCase(deleteDocument.fulfilled, (state, action) => {
                state.items = state.items.filter(doc => doc.id !== action.payload);
            })
            .addCase(deleteDocument.rejected, (state, action) => {
                state.error = action.payload;
                console.error(action.payload);
            })
            .addCase(fetchDocumentContent.pending, (state) => {
                state.contentLoading = true;
                state.error = null;
            })
            .addCase(fetchDocumentContent.fulfilled, (state, action) => {
                state.contentLoading = false;
                if (action.payload) {
                    const docId = action.payload.file.id;
                    state.documentsById[docId] = action.payload;
                }
            })
            .addCase(fetchDocumentContent.rejected, (state, action) => {
                state.contentLoading = false;
                state.error = action.payload;
            });
    },
});

export const {
    setSearchTerm,
    setSelectedShowDocumentContentID,
    toggleFileSelection,
    toggleSelectAll,
} = documentsSlice.actions;

export default documentsSlice.reducer;