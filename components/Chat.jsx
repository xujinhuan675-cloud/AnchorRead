'use client';

import { useState, useRef, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import ImageUpload from './ImageUpload';
import LoadingOverlay from './LoadingOverlay';
import { generateImagePrompt } from '@/lib/image-utils';
import { CHART_TYPES } from '@/lib/constants';
import { track } from '@vercel/analytics';

export default function Chat({ onSendMessage, isGenerating, initialInput = '', initialChartType = 'auto', initialEngine = 'excalidraw', onEngineChange, activeTab: tabProp = null, onTabChange = null, chartType: chartTypeProp = null, onChartTypeChange = null }) {
  const [tabState, setTabState] = useState('text'); // 'text', 'file', or 'image'
  // 宿主传入 activeTab/onTabChange 时走受控模式（图解面板把 tabs 提到头部子栏），否则内部自管
  const activeTab = tabProp ?? tabState;
  const changeTab = (next) => { if (tabProp === null) setTabState(next); onTabChange?.(next); };
  const [input, setInput] = useState(initialInput);
  const [chartTypeState, setChartTypeState] = useState(initialChartType); // Selected chart type
  // 图类型同样支持受控：图解面板头部子栏持有下拉，Chat 内部不再重复渲染
  const chartType = chartTypeProp ?? chartTypeState;
  const changeChartType = (next) => { if (chartTypeProp === null) setChartTypeState(next); onChartTypeChange?.(next); };
  const [engine, setEngine] = useState(initialEngine);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileStatus, setFileStatus] = useState(''); // '', 'parsing', 'success', 'error'
  const [fileError, setFileError] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);
  const [fileContent, setFileContent] = useState(''); // Store parsed file content
  const [canGenerate, setCanGenerate] = useState(false); // Track if generation is possible
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  // Track the last submission source to prevent unwanted input syncing
  const lastSubmitSourceRef = useRef('text'); // 'text' | 'file' | 'image'

  // Sync with parent state changes
  useEffect(() => {
    // Only sync initialInput into the text area for text-originated submissions
    // If the last submission came from file/image, suppress this one update
    if (lastSubmitSourceRef.current === 'text') {
      setInput(initialInput);
    } else {
      // Reset to allow future legitimate updates (e.g., history selection)
      lastSubmitSourceRef.current = 'text';
    }
  }, [initialInput]);

  useEffect(() => {
    if (chartTypeProp === null) setChartTypeState(initialChartType);
  }, [initialChartType, chartTypeProp]);

  useEffect(() => {
    setEngine(initialEngine);
  }, [initialEngine]);

  // 切换输入模式时按当前已备内容重置生成可用态：受控模式下 tabs 在宿主渲染，统一在这里兼容两种模式
  useEffect(() => {
    setCanGenerate(activeTab === 'file' ? Boolean(fileContent) : activeTab === 'image' ? Boolean(selectedImage) : false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const changeEngine = (nextEngine) => {
    setEngine(nextEngine);
    onEngineChange?.(nextEngine);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim() && !isGenerating) {
      track('text_submit');
      lastSubmitSourceRef.current = 'text';
      onSendMessage(input.trim(), chartType, 'text', engine);
      // Don't clear input - keep it for user reference
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      // Reset file-related state when no file is selected
      setSelectedFile(null);
      setFileStatus('');
      setFileError('');
      setFileContent('');
      setCanGenerate(false);
      return;
    }

    // Validate file type
    const validExtensions = ['.md', '.txt'];
    const fileExtension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!validExtensions.includes(fileExtension)) {
      setFileError('请选择 .md 或 .txt 文件');
      setFileStatus('error');
      setCanGenerate(false);
      return;
    }

    // Validate file size (max 1MB)
    const maxSize = 1 * 1024 * 1024; // 1MB in bytes
    if (file.size > maxSize) {
      setFileError('文件大小不能超过 1MB');
      setFileStatus('error');
      setCanGenerate(false);
      return;
    }

    setSelectedFile(file);
    setFileStatus('parsing');
    setFileError('');
    setFileContent(''); // Clear previous content
    setCanGenerate(false); // Disable generation until parsing is complete

    // Read file content
    const reader = new FileReader();

    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === 'string' && content.trim()) {
        setFileStatus('success');
        setFileContent(content.trim()); // Store content for manual generation
        setCanGenerate(true); // Enable generation button
        // Don't auto-submit the file content - wait for user to click generate button
      } else {
        setFileError('文件内容为空');
        setFileStatus('error');
        setCanGenerate(false);
      }
    };

    reader.onerror = () => {
      setFileError('文件读取失败');
      setFileStatus('error');
      setCanGenerate(false);
    };

    reader.readAsText(file);
  };

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileGenerate = () => {
    if (fileContent && !isGenerating) {
      track('file_submit');
      // Mark source as file to avoid syncing file content into text input
      lastSubmitSourceRef.current = 'file';
      onSendMessage(fileContent, chartType, 'file', engine);
      // Reset canGenerate state after initiating generation
      setCanGenerate(false);
    }
  };

  const handleImageSelect = (imageData) => {
    setSelectedImage(imageData);
    // 图片选择完成后，不立即发送处理请求
    // 用户需要点击"开始生成"按钮才会开始生成
    if (imageData) {
      setCanGenerate(true); // Enable generation button for image
    } else {
      setCanGenerate(false);
    }
  };

  const handleImageSubmit = () => {
    if (selectedImage && !isGenerating) {
      track('image_submit');
      // Mark source as image to avoid syncing into text input
      lastSubmitSourceRef.current = 'image';
      // 生成针对图片的提示词
      const imagePrompt = generateImagePrompt(chartType);

      // 创建包含图片数据的消息对象
      const messageData = {
        text: imagePrompt,
        image: selectedImage,
        chartType
      };

      onSendMessage(messageData, chartType, 'image', engine);
      // Reset canGenerate state after initiating generation
      setCanGenerate(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      {/* <div className="px-4 py-3 bg-white border-b border-stone-200">
        <h3 className="text-sm font-semibold text-stone-700">输入</h3>
      </div> */}

      {/* 输入模式 tabs：受控模式下由宿主渲染（图解面板头部子栏），这里不再重复占一行 */}
      {tabProp === null && (
      <div className="flex border-b border-stone-200 bg-stone-50">
        <button
          onClick={() => {
            changeTab('text');
            setCanGenerate(false); // Reset generation state when switching tabs
          }}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-200 ${
            activeTab === 'text'
              ? 'bg-white text-stone-900 border-b-2 border-stone-900'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          文本输入
        </button>
        <button
          onClick={() => {
            changeTab('file');
            setCanGenerate(!!fileContent); // Set generation state based on file content
          }}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-200 ${
            activeTab === 'file'
              ? 'bg-white text-stone-900 border-b-2 border-stone-900'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          文件上传
        </button>
        <button
          onClick={() => {
            changeTab('image');
            setCanGenerate(!!selectedImage); // Set generation state based on selected image
          }}
          className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-200 ${
            activeTab === 'image'
              ? 'bg-white text-stone-900 border-b-2 border-stone-900'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          图片上传
        </button>
      </div>
      )}

      {/* Content Area */}
      <div className="flex-1 flex flex-col">
        {/* Text Input Tab */}
        {activeTab === 'text' && (
          // 描述区与面板合并：去外边距与输入框自身描边，直接贴面板铺满，与画布贴边风格一致
          <div className="flex-1 flex flex-col relative">
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col">
              {/* 引擎与图类型已提到面板头部控制栏：表单区只保留描述输入 */}
              <div className="relative flex-1">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="描述您想要创建的图表..."
                  className="w-full h-full pl-3 pr-12 py-2.5 bg-transparent focus:outline-none resize-none text-sm scrollbar-hide text-stone-900 dark:text-stone-100 placeholder:text-stone-400"
                  style={{
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                  }}
                  disabled={isGenerating}
                />
                <button
                  type="submit"
                  disabled={!input.trim() || isGenerating}
                  className="absolute right-2 bottom-2 flex h-8 w-8 items-center justify-center rounded-full bg-stone-900 text-white transition-colors duration-200 hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-300"
                  title={isGenerating ? "生成中..." : "发送"}
                  aria-label="发送"
                >
                  {isGenerating ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
                  ) : (
                    // 上箭头是当下 AI 对话产品最常见的发送符号，比纸飞机更易识别
                    <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
                  )}
                </button>
              </div>
            </form>
            {/* Unified Loading Overlay */}
            <LoadingOverlay
              isVisible={isGenerating}
              message="正在生成图表..."
            />
          </div>
        )}

        {/* File Upload Tab */}
        {activeTab === 'file' && (
          <div className="flex-1 flex flex-col items-center  p-4 relative">
            {/* 引擎与图类型已提到面板头部控制栏 */}
            <div className="text-center mb-6">
              <p className="text-sm text-stone-600 mb-2">上传 Markdown 或文本文件</p>
              <p className="text-xs text-stone-400">支持 .md 和 .txt 格式，最大 1MB</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.txt"
              onChange={handleFileChange}
              className="hidden"
              disabled={isGenerating || fileStatus === 'parsing'}
            />

            <button
              onClick={handleFileButtonClick}
              disabled={isGenerating || fileStatus === 'parsing'}
              className="px-6 py-3 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors duration-200 flex items-center space-x-2"
            >
              {(isGenerating || fileStatus === 'parsing') ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              )}
              <span>
                {fileStatus === 'parsing' ? '解析中...' :
                 isGenerating ? '生成中...' : '选择文件'}
              </span>
            </button>

            {/* File Status */}
            {selectedFile && (
              <div className="mt-6 w-full max-w-md">
                <div className={`p-4 rounded border ${
                  fileStatus === 'success' ? 'bg-green-50 border-green-200' :
                  fileStatus === 'error' ? 'bg-red-50 border-red-200' :
                  'bg-blue-50 border-blue-200'
                }`}>
                  <div className="flex items-center space-x-3">
                    {fileStatus === 'parsing' && (
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                    )}
                    {fileStatus === 'success' && (
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {fileStatus === 'error' && (
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-stone-900 truncate">{selectedFile.name}</p>
                      {fileStatus === 'success' && !isGenerating && (
                        <p className="text-xs text-green-600 mt-1">文件已上传，可以开始生成</p>
                      )}
                      {fileStatus === 'success' && isGenerating && (
                        <p className="text-xs text-blue-600 mt-1">正在生成图表...</p>
                      )}
                      {fileStatus === 'error' && (
                        <p className="text-xs text-red-600 mt-1">{fileError}</p>
                      )}
                      {fileStatus === 'parsing' && (
                        <p className="text-xs text-blue-600 mt-1">正在解析文件...</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Generate Button */}
                {fileStatus === 'success' && !isGenerating && (
                  <div className="mt-4">
                    <button
                      onClick={handleFileGenerate}
                      disabled={!canGenerate}
                      className="w-full px-4 py-3 bg-stone-900 text-white rounded hover:bg-stone-800 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors duration-200 flex items-center justify-center space-x-2"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      <span>开始生成</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            {/* Unified Loading Overlay */}
            <LoadingOverlay
              isVisible={isGenerating || fileStatus === 'parsing'}
              message={fileStatus === 'parsing' ? '正在解析文件...' : '正在生成图表...'}
            />
          </div>
        )}

        {/* Image Upload Tab */}
        {activeTab === 'image' && (
          <div className="flex-1 flex flex-col relative">
            <ImageUpload
              onImageSelect={handleImageSelect}
              isGenerating={isGenerating}
              chartType={chartType}
              onChartTypeChange={changeChartType}
              onImageGenerate={handleImageSubmit}
              engine={engine}
              onEngineChange={changeEngine}
              hideControls={tabProp !== null}
            />
            {/* Unified Loading Overlay for image upload */}
            <LoadingOverlay
              isVisible={isGenerating}
              message="正在识别图片内容并生成图表..."
            />
          </div>
        )}
      </div>
    </div>
  );
}

