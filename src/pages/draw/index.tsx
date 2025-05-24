import React, { useEffect, useRef, useState } from 'react';
import { fabric } from 'fabric';
import { Button, Slider, Upload, message, Space, Card, Tooltip, Radio, Select, Spin, Input } from 'antd';
import {
  HighlightOutlined,
  DeleteOutlined,
  UndoOutlined,
  DownloadOutlined,
  UploadOutlined,
  ClearOutlined,
  CloudUploadOutlined,
} from '@ant-design/icons';
import type { UploadFile, RcFile } from 'antd/es/upload/interface';
import type { RadioChangeEvent } from 'antd';
import './index.less';
import { segmentClothes, convertTransparentToWhite, ClothType, OutputMode } from '../../utils/clothSegmentation';
type DrawMode = 'brush' | 'eraser' | 'select' | 'extract' | 'ai' | 'aiClick' | 'transparentEraser' | 'move';
type MaskAction = 'filter' | 'preserve';
interface OriginalImage {
  url: string;
  width: number;
  height: number;
}
// OSS上传
interface OSSData {
  expire: number;
  host: string;
  domain: string;
  accessKeyId: string;
  signature: string;
  policy: string;
  regionId: string;
  securityToken: string;
  bucket: string;
}
const isMode = (current: DrawMode, ...targets: DrawMode[]): boolean => {
  return targets.includes(current);
};
const DrawPage: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasInstanceRef = useRef<fabric.Canvas | null>(null);
  const maskCanvasRef = useRef<fabric.Canvas | null>(null);
  const originalImageRef = useRef<OriginalImage | null>(null);
  const segmenterRef = useRef<any | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('aiClick');
  const [brushSize, setBrushSize] = useState<number>(10);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [hasBackground, setHasBackground] = useState<boolean>(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [maskVisible, setMaskVisible] = useState<boolean>(true);
  const [extractedImage, setExtractedImage] = useState<string | null>(null);
  const [segmentationLoading, setSegmentationLoading] = useState<boolean>(false);
  const [modelLoading, setModelLoading] = useState<{loading: boolean, progress: number}>({loading: false, progress: 0});
  const [segmentationMask, setSegmentationMask] = useState<number[][][] | null>(null);
  const [hoveredClass, setHoveredClass] = useState<number | null>(null);
  const [savedSegments, setSavedSegments] = useState<Array<{
    id: string;
    url: string;
    className: string;
  }>>([]);
  const [eraserPaths, setEraserPaths] = useState<fabric.Path[]>([]);
  const [segmentationResult, setSegmentationResult] = useState<string | null>(null);
  const [supplementImageUrl, setSupplementImageUrl] = useState<string | null>(null);
  const segCanvasRef = useRef<fabric.Canvas | null>(null);  // 分割画布
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [drawingHistory, setDrawingHistory] = useState<fabric.Object[]>([]);
  const isDrawingRef = useRef<boolean>(false);
  // 添加图像历史状态，撤销
  const [previousImageStates, setPreviousImageStates] = useState<string[]>([]);
  // 添加拖动画布相关状态
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const lastMousePositionRef = useRef<{x: number, y: number} | null>(null);
  // 添加OSS上传状态
  const [ossData, setOssData] = useState<OSSData | null>(null);
  const [ossUploading, setOssUploading] = useState<boolean>(false);
  const [ossUploadUrl, setOssUploadUrl] = useState<string | null>(null);
  const [apiError, setApiError] = useState({visible: false, message: ''});
  // 初始化画布
  useEffect(() => {
    if (canvasRef.current) {
      // 主画布设置
      const canvas = new fabric.Canvas(canvasRef.current, {
        isDrawingMode: true,
        width: 800,
        height: 600,
        backgroundColor: '#fff',
      });
      canvasInstanceRef.current = canvas;

      // 分割结果画布
      const segCanvasElement = document.createElement('canvas');
      segCanvasElement.width = 800;
      segCanvasElement.height = 600;
      const segCanvas = new fabric.Canvas(segCanvasElement);
      segCanvas.setWidth(800);
      segCanvas.setHeight(600);
      segCanvasRef.current = segCanvas;

      // 蒙版画布
      maskCanvasRef.current = new fabric.Canvas(document.createElement('canvas'), {
        width: 800,
        height: 600,
      });

      // 笔刷设置
      const brush = new fabric.PencilBrush(canvas);
      brush.width = brushSize;
      brush.color = 'rgba(255, 0, 0, 0.5)';
      canvas.freeDrawingBrush = brush;

      // 滚轮缩放
      canvas.on('mouse:wheel', function(opt) {
        const delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** delta;
        zoom = Math.min(Math.max(0.5, zoom), 10);
        canvas.zoomToPoint(
          { x: opt.e.offsetX, y: opt.e.offsetY },
          zoom
        );
        setZoomLevel(zoom);
        opt.e.preventDefault();
        opt.e.stopPropagation();
      });

      // 跟踪绘制状态
      canvas.on('mouse:down', function() {
        if (canvas.isDrawingMode) {
          isDrawingRef.current = true;
        }
      });

      canvas.on('mouse:up', function() {
        if (canvas.isDrawingMode && isDrawingRef.current) {
          isDrawingRef.current = false;
        }
      });

      // 记录绘制路径
      canvas.on('object:added', function(e) {
        if (e.target && (e.target.type === 'path')) {
          const path = e.target;
          const pathColor = (path as any).stroke || 'unknown';
          const isBrush = pathColor === 'rgba(255, 0, 0, 0.5)';
          const isEraser = pathColor === 'rgba(0, 255, 255, 0.3)';
          if (isBrush || isEraser) {
            (path as any).uid = Date.now().toString();
            setDrawingHistory(prev => [...prev, path]);
            isDrawingRef.current = false;
          }
        }
      });

      saveCanvasState();
      return () => {
        canvas.dispose();
        maskCanvasRef.current?.dispose();
      };
    }
  }, []);
useEffect(() => {
  console.log('分割结果状态变更:', !!segmentationResult);
}, [segmentationResult]);
  // 更新笔刷大小
  useEffect(() => {
    if (canvasInstanceRef.current) {
      canvasInstanceRef.current.freeDrawingBrush.width = brushSize;
    }
  }, [brushSize]);
  useEffect(() => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;
    // 首先禁用所有模式的点击分割
    disableClickSegmentation();
    switch (drawMode) {
      case 'brush':
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = 'rgba(255, 0, 0, 0.5)';
        canvas.freeDrawingBrush.width = brushSize;
        canvas.defaultCursor = 'crosshair';
        break;
      case 'eraser':
        canvas.isDrawingMode = true;
        // 使用标橡皮擦
        canvas.freeDrawingBrush.color = 'rgba(255, 255, 255, 0.7)';
        canvas.freeDrawingBrush.width = brushSize * 1.0;
        canvas.defaultCursor = 'cell';
        break;
      case 'transparentEraser':
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = 'rgba(0, 255, 255, 0.3)';
        // 使用稍大宽度
        canvas.freeDrawingBrush.width = brushSize * 1.0;
        // 设置橡皮擦光标
        canvas.defaultCursor = 'not-allowed';
        break;
      case 'move':
        // 移动模式禁用绘图，设置为移动光标
        canvas.isDrawingMode = false;
        canvas.defaultCursor = 'move';
        canvas.selection = false;
        canvas.discardActiveObject();
        canvas.renderAll();
        // 事件监听
        canvas.off('mouse:down');
        canvas.off('mouse:move');
        canvas.off('mouse:up');

        canvas.on('mouse:down', function(opt) {
          setIsPanning(true);
          lastMousePositionRef.current = canvas.getPointer(opt.e);
        });
        canvas.on('mouse:move', function(opt) {
          if (isPanning && lastMousePositionRef.current) {
            const e = opt.e;
            const currentPointer = canvas.getPointer(e);
            // 计算位移
            const deltaX = currentPointer.x - lastMousePositionRef.current.x;
            const deltaY = currentPointer.y - lastMousePositionRef.current.y; 
            // 移动画布视口
            const vpt = canvas.viewportTransform;
            if (vpt) {
              vpt[4] += deltaX;
              vpt[5] += deltaY;
              canvas.setViewportTransform(vpt);
            } 
            // 更新最后鼠标位置
            lastMousePositionRef.current = currentPointer;
          }
        });
        canvas.on('mouse:up', function() {
          setIsPanning(false);
          lastMousePositionRef.current = null;
        });
        break;
      case 'select':
        canvas.isDrawingMode = false;
        // 重新启用选择功能
        canvas.selection = true;
        break;
      case 'extract':
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = 'rgba(0, 0, 255, 0.5)';
        canvas.freeDrawingBrush.width = brushSize;
        break;
      case 'aiClick':
        canvas.isDrawingMode = false;
        // 如果存在分割数据，启用点击交互
        if (segmentationMask) {
          enableClickSegmentation();
        }
        break;
      default:
        canvas.isDrawingMode = false;
        break;
    }
  }, [drawMode, brushSize, segmentationMask, isPanning]);
  // 保存画布状态到历史
  const saveCanvasState = () => {
    if (!canvasInstanceRef.current) return;
    const json = JSON.stringify(canvasInstanceRef.current.toJSON());
    // 如果不在末尾，删除当前索引后的所有内容
    if (historyIndex < history.length - 1) {
      setHistory(prev => prev.slice(0, historyIndex + 1));
    }
    
    setHistory(prev => [...prev, json]);
    setHistoryIndex(prev => prev + 1);
  };
  // 撤销
  const handleUndo = () => {
    if (historyIndex <= 0) return;
    
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;
    
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    
    canvas.loadFromJSON(history[newIndex], () => {
      canvas.renderAll();
    });
    // 清除抠图结果
    setExtractedImage(null);
  };
  // 清除画布（保留背景）
  const handleClear = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;
    const backgroundImage = canvas.backgroundImage;
    canvas.getObjects().forEach(obj => {
      canvas.remove(obj);
    });
    
    if (backgroundImage && hasBackground) {
      canvas.setBackgroundImage(backgroundImage, canvas.renderAll.bind(canvas));
    }
    // 清除蒙版画布
    if (maskCanvasRef.current) {
      maskCanvasRef.current.clear();
    }
    setFileList([]); // 清空上传图片区域
    // 清除已提取的图像
    setExtractedImage(null);
    // 清除已保存的分割图片
    setSavedSegments([]);
    // 清除绘制历史
    setDrawingHistory([]);
    saveCanvasState();
  };
  // 处理图像上传
  const handleUpload = async (info: any) => {
    if (info.file.status === 'uploading') {
      // 重置缩放
      if (canvasInstanceRef.current) {
        canvasInstanceRef.current.setZoom(1);
        canvasInstanceRef.current.setViewportTransform([1, 0, 0, 1, 0, 0]);
        setZoomLevel(1);
      }
      return;
    }

    // 清除所有状态
    const clearAllStates = () => {
      // 清空画布
      [canvasInstanceRef, maskCanvasRef, segCanvasRef].forEach(ref => {
        if (ref.current) {
          ref.current.clear();
          ref.current.discardActiveObject();
          ref.current.renderAll();
          if (ref === canvasInstanceRef) {
            ref.current.setZoom(1);
            ref.current.setViewportTransform([1, 0, 0, 1, 0, 0]);
          }
        }
      });

      // 重置状态
      setHistory([]);
      setHistoryIndex(-1);
      setSavedSegments([]);
      setExtractedImage(null);
      setSegmentationResult(null);
      setSupplementImageUrl(null);
      setSegmentationMask(null);
      setHoveredClass(null);
      setHasBackground(false);
      setEraserPaths && setEraserPaths([]);
      setDrawingHistory([]);
      setZoomLevel(1);
      originalImageRef.current = null;

      // 清除画布背景
      if (canvasInstanceRef.current) {
        canvasInstanceRef.current.setBackgroundImage('', () => {
          canvasInstanceRef.current?.renderAll();
        });
      }
    };

    if (info.file.status === 'done') {
      clearAllStates();
      const fileObj = info.file.originFileObj;
      if (!fileObj) {
        message.error('无法获取文件');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          const imgSrc = e.target.result as string;
          processUploadedImage(imgSrc);
        }
      };
      reader.onerror = () => {
        message.error('文件读取失败');
      };
      reader.readAsDataURL(fileObj);
    } else if (info.file.status === 'removed') {
      clearAllStates();
      setFileList([]);
      message.success('已清除所有数据');
    }
  };
// 处理上传图像的加载和显示
const processUploadedImage = (imgUrl: string) => {
  console.log('开始处理上传图像...');
  
  // 先清除所有状态和数据
  const clearAllStates = () => {
    console.log('清除所有状态...');
    // 清除所有画布
    const currentCanvas = canvasInstanceRef.current;
    if (currentCanvas) {
      currentCanvas.clear();
      currentCanvas.setBackgroundImage('', currentCanvas.renderAll.bind(currentCanvas));
      currentCanvas.renderAll();
      currentCanvas.off('mouse:down');
      currentCanvas.defaultCursor = 'default';
      // 重置画布缩放和位置
      currentCanvas.setZoom(1);
      currentCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      // 更新缩放级别状态
      setZoomLevel(1);
    }
    if (maskCanvasRef.current) {
      maskCanvasRef.current.clear();
      maskCanvasRef.current.renderAll();
    } 
    if (segCanvasRef.current) {
      segCanvasRef.current.clear();
      segCanvasRef.current.renderAll();
    }
    // 重置所有状态变量
    setHistory([]);
    setHistoryIndex(-1);
    setSavedSegments([]); // 立即清空分割图片库
    setExtractedImage(null);
    setSegmentationResult(null); // 确保清除分割结果
    setSupplementImageUrl(null);
    setSegmentationMask(null);
    setHoveredClass(null);
    setHasBackground(false);
    setEraserPaths && setEraserPaths([]);
    // 重置绘制历史
    setDrawingHistory([]);
    // 清除原始图片引用
    originalImageRef.current = null;
  };
  // 执行清理
  clearAllStates();
  // 创建图像对象，获取图像尺寸
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) {
      message.error('画布未初始化');
      return;
    }
    // 清除现有内容
    canvas.clear();
    // 重置绘制模式
    setDrawMode('aiClick');
    // 设置背景图像
    fabric.Image.fromURL(imgUrl, (fabricImg) => {
      // 调整图像大小以适应画布
      const canvasWidth = canvas.width || 800;
      const canvasHeight = canvas.height || 600; 
      const scale = Math.min(
        canvasWidth / fabricImg.width!,
        canvasHeight / fabricImg.height!
      );
      fabricImg.scale(scale);
      // 居中放置
      fabricImg.set({
        left: (canvasWidth - fabricImg.width! * scale) / 2,
        top: (canvasHeight - fabricImg.height! * scale) / 2,
        selectable: false,
        evented: false
      });
      canvas.setBackgroundImage(fabricImg, canvas.renderAll.bind(canvas));
      setHasBackground(true);
      const json = JSON.stringify(canvas.toJSON());
      setHistory([json]);
      setHistoryIndex(0);
      message.success('图片上传成功，开始执行分割...');
      // 延迟执行分割，确保状态已完全清除
      setTimeout(() => {
        performAISegmentation(imgUrl);
      }, 100);
    });
  };
  img.onerror = () => {
    message.error('图片加载失败');
  }; 
  img.src = imgUrl;
};
 // 修改 beforeUpload 处理函数
const beforeUpload = (file: RcFile) => {
  // 验证文件类型
  const isImage = file.type.startsWith('image/');
  if (!isImage) {
    message.error('只能上传图片文件!');
    return false;
  }
  console.log('开始上传前清理...');
  // 先清除所有监听器和重置交互状态
  if (canvasInstanceRef.current) {
    canvasInstanceRef.current.off('mouse:down');
    canvasInstanceRef.current.defaultCursor = 'default';
    // 重置画布缩放和位置
    canvasInstanceRef.current.setZoom(1);
    canvasInstanceRef.current.setViewportTransform([1, 0, 0, 1, 0, 0]);
    setZoomLevel(1);
  }
  // 强制清除所有状态，包括分割结果
  setSegmentationResult(null);
  setSegmentationMask(null);
  setExtractedImage(null);
  setSupplementImageUrl(null);
  setHoveredClass(null);
  setHasBackground(false);
  setFileList([]);
  setHistory([]);
  setHistoryIndex(-1);
  setSavedSegments([]);
  // 清理画布
  if (canvasInstanceRef.current) {
    canvasInstanceRef.current.clear();
    canvasInstanceRef.current.setBackgroundImage('', canvasInstanceRef.current.renderAll.bind(canvasInstanceRef.current));
  }
  if (maskCanvasRef.current) {
    maskCanvasRef.current.clear();
  }
  if (segCanvasRef.current) {
    segCanvasRef.current.clear();
  }
  // 清除原始图片引用
  originalImageRef.current = null;
  try {
    const imgUrl = URL.createObjectURL(file);
    // 手动设置文件列表
    setFileList([{
      uid: file.uid || Date.now().toString(),
      name: file.name,
      status: 'done',
      url: imgUrl,
      originFileObj: file
    }]);
    // 添加延时处理图像，确保状态清理完成
    setTimeout(() => {
      processUploadedImage(imgUrl);
    }, 100);
  } catch (error) {
    console.error('处理文件失败:', error);
    message.error('文件处理失败，请重试');
  }
  // 阻止默认上传行为
  return false;
};
  // 处理提取功能 - 提取用户手绘区域 (从原有代码集成)
  const handleOldExtract = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas || !canvas.backgroundImage) {
      message.warning('请先上传背景图片');
      return;
    }
    // 获取所有路径对象 - 只获取红色画笔路径
    const brushPaths = canvas.getObjects().filter((obj: fabric.Object) => {
      // 区分是画笔，只保留红色画笔路径
      return obj.type === 'path' && 
        ((obj as any).stroke === 'rgba(255, 0, 0, 0.5)' || 
         (obj as any).fill === 'rgba(255, 0, 0, 0.5)');
    }) as fabric.Path[];
    // 获取所有橡皮擦路径
    const eraserPaths = canvas.getObjects().filter((obj: fabric.Object) => {
      // 区分是橡皮擦(白色)
      return obj.type === 'path' && 
        ((obj as any).stroke === 'rgba(255, 255, 255, 0.7)' || 
         (obj as any).fill === 'rgba(255, 255, 255, 0.7)');
    }) as fabric.Path[];
    
    if (brushPaths.length === 0) {
      message.warning('请先用红色画笔涂抹要提取的区域');
      return;
    }
    // 获取背景图片信息
    const bgImage = canvas.backgroundImage as fabric.Image;
    const imgElement = bgImage.getElement() as HTMLImageElement;
    // 获取图片实际显示尺寸
    const scaleX = bgImage.scaleX || 1;
    const scaleY = bgImage.scaleY || 1;
    const displayWidth = (bgImage.width || imgElement.width) * scaleX;
    const displayHeight = (bgImage.height || imgElement.height) * scaleY;
    const left = bgImage.left || 0;
    const top = bgImage.top || 0;
    // 创建临时画布 - 使用图片实际尺寸
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = displayWidth;
    tempCanvas.height = displayHeight;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) {
      message.error('无法创建临时画布');
      return;
    }
    // 绘制背景图像，位置和大小与画布上显示一致
    ctx.drawImage(
      imgElement,
      0, 0, imgElement.width, imgElement.height,
      0, 0, displayWidth, displayHeight
    );
    // 创建蒙版画布 (用于标记涂抹区域)
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = displayWidth;
    maskCanvas.height = displayHeight;
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) {
      message.error('无法创建蒙版画布');
      return;
    }
    // 初始化蒙版为黑色背景，表示未涂抹的区域
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    // 白色绘制所有红色画笔涂抹的区域
    drawPathsOnMask(maskCtx, brushPaths, 'white', left, top);
    // 使用黑色绘制所有橡皮擦路径，覆盖之前的红色画笔区域
    if (eraserPaths.length > 0) {
      drawPathsOnMask(maskCtx, eraserPaths, 'black', left, top);
    }
    // 获取图像数据
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    // 逐像素处理图像数据
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (maskData.data[i] < 200) { // 判断为黑色区域（未涂抹或被橡皮擦擦除）
        imageData.data[i+3] = 0; // 设置alpha通道为0（完全透明）
      }
    }
    // 将处理后的图像数据放回画布
    ctx.putImageData(imageData, 0, 0);
    // 将结果转为数据URL并显示
    const extractedImg = tempCanvas.toDataURL('image/png', 1.0);
    setExtractedImage(extractedImg);
    message.success('分割成功');
  };
  
  // 在蒙版上绘制路径
  const drawPathsOnMask = (
    ctx: CanvasRenderingContext2D, 
    paths: fabric.Path[], 
    color: string, 
    offsetX: number, 
    offsetY: number
  ) => {
    paths.forEach((path: fabric.Path) => {
      ctx.save();
      // 设置绘制样式
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      // 使用画笔原始宽度，确保覆盖涂抹区域
      const strokeWidth = path.strokeWidth || brushSize;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // 调整绘制位置，考虑背景图的位置偏移
      ctx.translate(-offsetX, -offsetY);
      // 绘制路径
      if ((path as any)._objects) {
        // 处理复合路径
        (path as any)._objects.forEach((p: fabric.Path) => {
          ctx.beginPath();
          const pathData = p.path as unknown as (Array<[string, ...number[]]>);
          if (pathData) {
            for (let i = 0; i < pathData.length; i++) {
              const point = pathData[i];
              if (point[0] === 'M') {
                ctx.moveTo(point[1], point[2]);
              } else if (point[0] === 'L') {
                ctx.lineTo(point[1], point[2]);
              } else if (point[0] === 'Q') {
                ctx.quadraticCurveTo(point[1], point[2], point[3], point[4]);
              } else if (point[0] === 'C') {
                ctx.bezierCurveTo(point[1], point[2], point[3], point[4], point[5], point[6]);
              } else if (point[0] === 'Z') {
                ctx.closePath();
              }
            }
            // 描边
            ctx.stroke();
          }
        });
      } else if (path.path) {
        // 处理单个路径
        ctx.beginPath();
        const pathData = path.path as unknown as (Array<[string, ...number[]]>);
        for (let i = 0; i < pathData.length; i++) {
          const point = pathData[i];
          if (point[0] === 'M') {
            ctx.moveTo(point[1], point[2]);
          } else if (point[0] === 'L') {
            ctx.lineTo(point[1], point[2]);
          } else if (point[0] === 'Q') {
            ctx.quadraticCurveTo(point[1], point[2], point[3], point[4]);
          } else if (point[0] === 'C') {
            ctx.bezierCurveTo(point[1], point[2], point[3], point[4], point[5], point[6]);
          } else if (point[0] === 'Z') {
            ctx.closePath();
          }
        }
        // 描边
        ctx.stroke();
      }
      
      ctx.restore();
    });
  };

  // 应用蒙版到图像（过滤或保留）
  const applyMask = (action: MaskAction) => {
    const canvas = canvasInstanceRef.current;
    const maskCanvas = maskCanvasRef.current;
    
    if (!canvas || !maskCanvas) {
      message.warning('请先上传图片并创建蒙版');
      return;
    }
    // 获取背景图像
    const bgImage = canvas.backgroundImage as fabric.Image;
    if (!bgImage) {
      message.warning('请先上传图片');
      return;
    }
    // 获取主画布的所有路径（这些是蒙版路径）
    const objects = canvas.getObjects();
    if (objects.length === 0) {
      message.warning('请先创建蒙版区域');
      return;
    }
    // 创建临时画布用于处理
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width || 800;
    tempCanvas.height = canvas.height || 600;
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) {
      message.error('无法创建临时画布');
      return;
    }
    // 绘制原始图像到临时画布
    const imgElement = bgImage.getElement() as HTMLImageElement;
    const scale = bgImage.scaleX || 1;
    const width = (bgImage.width || 1) * scale;
    const height = (bgImage.height || 1) * scale;
    const left = bgImage.left || 0;
    const top = bgImage.top || 0;
    
    tempCtx.drawImage(
      imgElement,
      0, 0, imgElement.width, imgElement.height,
      left, top, width, height
    );
         
    const maskTempCanvas = document.createElement('canvas');
    maskTempCanvas.width = canvas.width || 800;
    maskTempCanvas.height = canvas.height || 600;
    const maskTempCtx = maskTempCanvas.getContext('2d');
    
    if (!maskTempCtx) {
      message.error('无法创建蒙版画布');
      return;
    }
    
    maskTempCtx.fillStyle = 'white';
    maskTempCtx.fillRect(0, 0, maskTempCanvas.width, maskTempCanvas.height);
    
    if (action === 'filter') {
      maskTempCtx.globalCompositeOperation = 'destination-out';
    } else {
      maskTempCtx.fillStyle = 'black';
      maskTempCtx.fillRect(0, 0, maskTempCanvas.width, maskTempCanvas.height);
      maskTempCtx.globalCompositeOperation = 'destination-in';
    }
    
    objects.forEach(obj => {
      if (obj.type === 'path') {
        const pathCanvas = document.createElement('canvas');
        pathCanvas.width = canvas.width || 800;
        pathCanvas.height = canvas.height || 600;
        
        const pathCanvasObj = new fabric.StaticCanvas(pathCanvas);
        pathCanvasObj.add(obj);
        pathCanvasObj.renderAll();
        
        maskTempCtx.drawImage(pathCanvas, 0, 0);
        
        pathCanvasObj.dispose();
      }
    });
    
    // 将蒙版应用到图像
    tempCtx.globalCompositeOperation = 'destination-in';
    tempCtx.drawImage(maskTempCanvas, 0, 0);
    
    // 将结果保存为提取的图像
    const extractedImg = tempCanvas.toDataURL('image/png', 1.0);
    setExtractedImage(extractedImg);
    
  
  };
  
  // 基于路径提取图像（保留旧方法作为参考）
  const handleExtract = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas || !canvas.backgroundImage) {
      message.warning('请先上传图片');
      return;
    }
    
    // 获取所有路径（假设最后一个路径是提取路径）
    const objects = canvas.getObjects();
    const extractionPath = objects[objects.length - 1];
    
    if (!extractionPath || extractionPath.type !== 'path') {
      message.warning('请先绘制提取路径');
      return;
    }
    
    // 创建裁剪路径
    const bg = canvas.backgroundImage as fabric.Image;
    const clonedImage = new fabric.Image(bg.getElement() as HTMLImageElement, {
      left: bg.left,
      top: bg.top,
      scaleX: bg.scaleX,
      scaleY: bg.scaleY,
    });
    
    // 创建裁剪蒙版
    clonedImage.clipPath = extractionPath;
    
    // 移除路径
    canvas.remove(extractionPath);
    
    // 添加裁剪后的图像
    canvas.add(clonedImage);
    canvas.renderAll();
    
    saveCanvasState();
  };

  // 下载画布图像或可用的提取图像
  const handleDownload = () => {
    // 如果有提取的图像，下载它
    if (extractedImage) {
      // 创建一个临时图像对象来加载当前提取的图像
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // 获取原始图像的精确尺寸
        const originalWidth = img.naturalWidth;
        const originalHeight = img.naturalHeight;
        
        console.log(`保持原始图像尺寸: ${originalWidth}x${originalHeight}，不进行任何缩放处理`);
        
        // 创建一个临时画布，必须使用完全相同的尺寸
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = originalWidth;
        tempCanvas.height = originalHeight;
        const ctx = tempCanvas.getContext('2d', { 
          alpha: true,
          willReadFrequently: true,
          // 使用最高质量设置
          desynchronized: false
        });
        
        if (!ctx) {
          message.error('创建画布失败');
          return;
        }
        
        // 完全禁用图像平滑，保持像素精确
        ctx.imageSmoothingEnabled = false;
        // @ts-ignore - 不同浏览器的实现
        ctx.webkitImageSmoothingEnabled = false;
        // @ts-ignore
        ctx.mozImageSmoothingEnabled = false;
        // @ts-ignore
        ctx.msImageSmoothingEnabled = false;
        
        // 先填充白色背景
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, originalWidth, originalHeight);
        
        // 然后在上面逐像素绘制原始图像，1:1不缩放
        ctx.drawImage(img, 0, 0);
        
        // 转换为图片数据，使用PNG无损格式和最高质量
        const dataURL = tempCanvas.toDataURL('image/png', 1.0);
        
        // 创建下载链接
        const link = document.createElement('a');
        const filename = drawMode === 'ai' ? 'ai-segmented-image-white.png' : 'extracted-image-white.png';
        link.download = filename;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
      };
      
      img.onerror = () => {
        message.error('加载图片失败');
      };
      
      // 加载当前提取的图像
      img.src = extractedImage;
      return;
    }
    
    // 否则下载画布
    if (!canvasInstanceRef.current) return;
    
    // 获取当前画布
    const canvas = canvasInstanceRef.current;
    
    // 获取Fabric.js画布的精确尺寸
    const originalWidth = canvas.getWidth();
    const originalHeight = canvas.getHeight();
    
    console.log(`保持画布原始尺寸: ${originalWidth}x${originalHeight}，不进行任何缩放或压缩`);
    
    // 创建一个临时画布，使用完全相同的尺寸
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalWidth;
    tempCanvas.height = originalHeight;
    const tempCtx = tempCanvas.getContext('2d', { 
      alpha: true,
      willReadFrequently: true,
      // 使用最高质量设置
      desynchronized: false 
    });
    
    if (!tempCtx) {
      message.error('创建画布失败');
      return;
    }
    
    // 完全禁用平滑处理以保留像素精度
    tempCtx.imageSmoothingEnabled = false;
    // @ts-ignore - 不同浏览器的实现
    tempCtx.webkitImageSmoothingEnabled = false;
    // @ts-ignore
    tempCtx.mozImageSmoothingEnabled = false;
    // @ts-ignore
    tempCtx.msImageSmoothingEnabled = false;
    
    // 填充白色背景
    tempCtx.fillStyle = 'white';
    tempCtx.fillRect(0, 0, originalWidth, originalHeight);
    
    // 使用正确的方式获取Fabric.js画布的底层元素
    const canvasElement = canvas.getElement() as HTMLCanvasElement;
    // 精确复制原始画布内容，1:1不缩放
    tempCtx.drawImage(canvasElement, 0, 0);
    
    // 使用临时画布生成图像数据，使用无损PNG和最高质量设置
    const dataURL = tempCanvas.toDataURL('image/png', 1.0);
    
    const link = document.createElement('a');
    link.download = 'canvas-image-white.png';
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
  };

  // Handle mode change
  const handleModeChange = (e: RadioChangeEvent) => {
    const newMode = e.target.value as DrawMode;
    
    // 重置绘制历史记录当切换模式时
    setDrawingHistory([]);
    
    // 如果切换到橡皮擦模式且有分割结果，将分割结果放到左侧画布
    if (newMode === 'transparentEraser' && extractedImage) {
      const canvas = canvasInstanceRef.current;
      if (canvas) {
        // 清除当前左侧画布，仅保留背景
        const bgImage = canvas.backgroundImage;
        canvas.clear();
        
        // 清除所有现有的橡皮擦路径，避免累积重复路径
        const existingPaths = canvas.getObjects().filter((obj: fabric.Object) => {
          return obj.type === 'path' && 
            ((obj as any).stroke === 'rgba(0, 255, 255, 0.3)' || 
             (obj as any).fill === 'rgba(0, 255, 255, 0.3)');
        });
        existingPaths.forEach(path => canvas.remove(path));
        
        // 加载分割图像到左侧画布 - 使用原始尺寸
        fabric.Image.fromURL(extractedImage, (img) => {
          // 获取原始图像尺寸
          const imgElement = new Image();
          imgElement.onload = () => {
            const originalWidth = imgElement.naturalWidth;
            const originalHeight = imgElement.naturalHeight;
            
            // 调整画布大小以适应图像尺寸
            const canvasWidth = canvas.width || 800;
            const canvasHeight = canvas.height || 600;
            
            // 计算合适的缩放因子以保持原始质量
            const scale = Math.min(
              canvasWidth / originalWidth,
              canvasHeight / originalHeight
            );
            
            // 使用计算出的最佳缩放比例
            img.scale(scale);
            
            // 居中放置
            img.set({
              left: (canvasWidth - originalWidth * scale) / 2,
              top: (canvasHeight - originalHeight * scale) / 2,
              selectable: false,
              evented: false,
              // 保存原始图像数据，以便后续处理时使用
              data: {
                originalWidth,
                originalHeight
              }
            });
            
            // 添加到画布
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            setHasBackground(true);
            
            // 设置透明橡皮擦模式
            canvas.isDrawingMode = true;
            canvas.freeDrawingBrush.color = 'rgba(0, 255, 255, 0.3)';
            canvas.freeDrawingBrush.width = brushSize * 1.5;
            
            // 清空之前的橡皮擦路径
            setEraserPaths([]);
            
            // 保存画布状态
            saveCanvasState();
          };
          imgElement.src = extractedImage;
        });
      }
    }
    
    setDrawMode(newMode);
  };

  // 处理画笔大小变更
  const handleBrushSizeChange = (value: number) => {
    setBrushSize(value);
  };

  // Enable click-based segmentation visualization
  const enableClickSegmentation = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) {
      message.error('画布未初始化');
      return;
    }
    
    if (!segmentationResult) {
      message.warning('请先执行AI分割');
      return;
    }
    
    setDrawMode('aiClick');
    canvas.defaultCursor = 'pointer';
    canvas.off('mouse:down');
    message.success('请点击服装区域进行提取');
    enableClickSegmentationWithData(segmentationResult);
  };
  
  // 禁用点击式分割可视化
  const disableClickSegmentation = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;
    
    // 重置光标
    canvas.defaultCursor = 'default';
    
    // 移除点击监听器
    canvas.off('mouse:down');
    
    // 重置悬停类别
    setHoveredClass(null);
    
    // 如果在aiClick模式，重置提取的图像
    if (drawMode === 'aiClick') {
      // 不重置提取的图像，保留当前结果
      // setExtractedImage(null);
    }
  };
  
  // 处理画布点击事件 - 已被新函数替代，仅保留作为参考
  const handleCanvasClickOld = (options: fabric.IEvent) => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) {
      console.error('点击处理：画布不存在');
      return;
    }
    
    if (!segmentationResult) {
      console.error('点击处理：分割图像不存在');
      message.warning('请等待AI分割完成');
      return;
    }

    const pointer = canvas.getPointer(options.e);
    const bgImage = canvas.backgroundImage as fabric.Image;
    
    if (!bgImage) {
      message.warning('请先上传图片');
      return;
    }

    try {
      // 创建图像对象以分析分割结果
      const segmentedImg = new Image();
      segmentedImg.crossOrigin = 'anonymous';
      
      segmentedImg.onload = () => {
        try {
          // 获取背景图像元素
          const imgElement = bgImage.getElement() as HTMLImageElement;
          
          // 获取背景图像在画布上的比例和位置
          const scaleX = bgImage.scaleX || 1;
          const scaleY = bgImage.scaleY || 1;
          const left = bgImage.left || 0;
          const top = bgImage.top || 0;
          
          // 计算图像显示尺寸
          const imgWidth = imgElement.width * scaleX;
          const imgHeight = imgElement.height * scaleY;
          
          // 调整指针位置相对于图像
          const relativeX = pointer.x - left;
          const relativeY = pointer.y - top;
          // 转换为标准化坐标（0-1）
          const normalizedX = Math.max(0, Math.min(1, relativeX / imgWidth));
          const normalizedY = Math.max(0, Math.min(1, relativeY / imgHeight));
          // 映射到分割图像坐标
          const maskX = Math.floor(normalizedX * segmentedImg.width);
          const maskY = Math.floor(normalizedY * segmentedImg.height);
          // 创建临时画布来读取像素颜色
          const pixelCanvas = document.createElement('canvas');
          pixelCanvas.width = segmentedImg.width;
          pixelCanvas.height = segmentedImg.height;
          const pixelCtx = pixelCanvas.getContext('2d', { willReadFrequently: true });
          
          if (!pixelCtx) {
            message.error('无法创建临时画布上下文');
            return;
          }
          
          // 绘制分割图像
          pixelCtx.drawImage(segmentedImg, 0, 0);
          
          // 获取点击位置周围的像素颜色（使用3x3区域）
          const radius = 2;
          let dominantColor = { r: 0, g: 0, b: 0, count: 0 };
          
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const px = Math.max(0, Math.min(segmentedImg.width - 1, maskX + dx));
              const py = Math.max(0, Math.min(segmentedImg.height - 1, maskY + dy));
              const pixelData = pixelCtx.getImageData(px, py, 1, 1).data;
              dominantColor.r += pixelData[0];
              dominantColor.g += pixelData[1];
              dominantColor.b += pixelData[2];
              dominantColor.count++;
            }
          }
          
          // 计算平均颜色
          const avgR = dominantColor.r / dominantColor.count;
          const avgG = dominantColor.g / dominantColor.count;
          const avgB = dominantColor.b / dominantColor.count;
          
          // 根据主导颜色确定类别
          let bestClass = 0;
          let className = '背景';
          
          if (avgR > 150 && avgG < 100 && avgB < 100) {
            bestClass = 3; // 红色，连衣裙
            className = '连衣裙';
          } else if (avgG > 150 && avgR < 100 && avgB < 100) {
            bestClass = 2; // 绿色，裤子
            className = '裤子';
          } else if (avgB > 150 && avgR < 100 && avgG < 100) {
            bestClass = 1; // 蓝色，上衣
            className = '上衣';
          } else {
            message.info('请点击服装区域');
            return;
          }
          
          // 根据类别提取对应区域
          visualizeSegmentationClass(bestClass, segmentedImg);
          
        } catch (error) {
          console.error('处理点击区域时出错:', error);
          message.error('处理点击区域失败，请重试');
        }
      };
      
      segmentedImg.src = segmentationResult;
      
    } catch (error) {
      console.error('处理点击事件失败:', error);
      message.error('处理点击失败，请重试');
    }
  };

  // 可视化特定分割类别
  const visualizeSegmentationClass = (classIndex: number, segmentedImg: HTMLImageElement) => {
    const canvas = canvasInstanceRef.current;
    if (!canvas || !canvas.backgroundImage) {
      console.error('无法可视化：画布或背景图像不存在');
      return null;
    }
    try {
      // 获取背景图像
      const bgImage = canvas.backgroundImage as fabric.Image;
      const imgElement = bgImage.getElement() as HTMLImageElement;
      
      // 创建临时画布
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = imgElement.width;
      tempCanvas.height = imgElement.height;
      const tempCtx = tempCanvas.getContext('2d');
      
      if (!tempCtx) {
        console.error('无法创建临时画布上下文');
        return null;
      }

      // 如果有已提取的图像，先绘制它
      if (extractedImage) {
        const existingImg = new Image();
        existingImg.src = extractedImage;
        tempCtx.drawImage(existingImg, 0, 0, tempCanvas.width, tempCanvas.height);
      } else {
        // 如果没有已提取的图像，绘制原始图像
        tempCtx.drawImage(imgElement, 0, 0, imgElement.width, imgElement.height);
      }
      
      // 创建分割掩码画布
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = segmentedImg.width;
      maskCanvas.height = segmentedImg.height;
      const maskCtx = maskCanvas.getContext('2d');
      
      if (!maskCtx) {
        console.error('无法创建掩码画布上下文');
        return null;
      }
      
      // 绘制分割图像
      maskCtx.drawImage(segmentedImg, 0, 0);
      
      // 获取掩码数据
      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      
      // 获取图像数据
      const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      const data = imageData.data;
      
      // 计算缩放比例
      const scaleX = tempCanvas.width / maskCanvas.width;
      const scaleY = tempCanvas.height / maskCanvas.height;
      
      console.log('处理图像尺寸:', {
        原图: { 
          width: tempCanvas.width, 
          height: tempCanvas.height 
        },
        分割图: { 
          width: maskCanvas.width, 
          height: maskCanvas.height 
        },
        比例: { 
          x: scaleX, 
          y: scaleY 
        },
        类别: classIndex
      });
      
      // 获取预期的颜色，基于类别索引
      let targetR = 0, targetG = 0, targetB = 0;
      
      if (classIndex === 1) {
        // 上衣: 蓝色
        targetR = 0; targetG = 0; targetB = 255;
      } else if (classIndex === 2) {
        // 裤子: 绿色
        targetR = 0; targetG = 255; targetB = 0;
      } else if (classIndex === 3) {
        // 连衣裙: 红色
        targetR = 255; targetG = 0; targetB = 0;
      }
      
      console.log(`目标颜色: RGB(${targetR},${targetG},${targetB})`);
      
      // 颜色计数
      const colorCounts = {
        blue: 0,
        green: 0,
        red: 0,
        black: 0,
        other: 0,
        matched: 0
      };
      
      // 遍历每个像素
      for (let y = 0; y < tempCanvas.height; y++) {
        for (let x = 0; x < tempCanvas.width; x++) {
          // 计算对应的掩码坐标
          const maskX = Math.min(maskCanvas.width - 1, Math.floor(x / scaleX));
          const maskY = Math.min(maskCanvas.height - 1, Math.floor(y / scaleY));
          
          // 获取掩码像素在数据数组中的索引
          const maskIdx = (maskY * maskCanvas.width + maskX) * 4;
          
          // 获取掩码RGB值
          const r = maskData.data[maskIdx];
          const g = maskData.data[maskIdx + 1];
          const b = maskData.data[maskIdx + 2];
          
          // 统计颜色分布
          if (r < 50 && g < 50 && b > 200) {
            // 蓝色
            colorCounts.blue++;
          } else if (r < 50 && g > 200 && b < 50) {
            // 绿色
            colorCounts.green++;
          } else if (r > 200 && g < 50 && b < 50) {
            // 红色
            colorCounts.red++;
          } else if (r < 50 && g < 50 && b < 50) {
            // 黑色
            colorCounts.black++;
          } else {
            // 其他颜色
            colorCounts.other++;
          }
          
          // 判断是否为目标类别
          let isTargetClass = false;
          
          // 根据颜色判断类别
          if (classIndex === 1 && r < 50 && g < 50 && b > 200) {
            // 蓝色 = 上衣
            isTargetClass = true;
            colorCounts.matched++;
          } else if (classIndex === 2 && r < 50 && g > 200 && b < 50) {
            // 绿色 = 裤子
            isTargetClass = true;
            colorCounts.matched++;
          } else if (classIndex === 3 && r > 200 && g < 50 && b < 50) {
            // 红色 = 连衣裙
            isTargetClass = true;
            colorCounts.matched++;
          }
          
          const idx = (y * tempCanvas.width + x) * 4;
          if (!isTargetClass && !extractedImage) {
            data[idx + 3] = 0; // 透明
          }
        }
      }
      console.log('分割图像颜色统计:', colorCounts);
      // 更新图像数据
      tempCtx.putImageData(imageData, 0, 0);
      // 返回处理后的图像URL
      const resultUrl = tempCanvas.toDataURL('image/png', 1.0);
      // 获取类别名称
      const className = classIndex === 0 ? '背景' :
                        classIndex === 1 ? '上衣' :
                        classIndex === 2 ? '裤子' :
                        classIndex === 3 ? '连衣裙' : '未知';
      
      // 将提取的图像添加到保存列表，以正确的格式
      setSavedSegments((prev) => [
        ...prev, 
        { 
          id: `segment-${Date.now()}`, 
          url: resultUrl, 
          className 
        }
      ]);
      
      // 设置当前提取的图像
      setExtractedImage(resultUrl);
      
      // 成功提示
      message.success(`已添加: ${className}`);

      return resultUrl;
    } catch (error) {
      console.error('可视化分割类别失败:', error);
      message.error('可视化分割失败，请重试');
      return null;
    }
  };

  // 处理点击保存的分割图片
  const handleSegmentClick = (segmentUrl: string) => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;
    
    // 完全清除画布上的所有内容，包括背景图片
    canvas.clear();
    
    // 重置画布状态
    setHasBackground(false);
    const img = new Image();
    img.onload = () => {
      // 创建fabric图像对象
      const fabricImg = new fabric.Image(img);
      // 缩放图像以适应画布
      const canvasWidth = canvas.width || 800;
      const canvasHeight = canvas.height || 600;
      
      const scale = Math.min(
        canvasWidth / fabricImg.width!,
        canvasHeight / fabricImg.height!
      ) * 0.8;
      
      fabricImg.scale(scale);
      
      // 居中放置
      fabricImg.left = (canvasWidth - fabricImg.width! * scale) / 2;
      fabricImg.top = (canvasHeight - fabricImg.height! * scale) / 2;
      
      // 添加到画布
      canvas.add(fabricImg);
      canvas.setActiveObject(fabricImg);
      canvas.renderAll();
      
      // 保存状态
      saveCanvasState();
    };
    
    img.src = segmentUrl;
  };
  
  // 清除保存的分割图片
  const clearSavedSegments = () => {
    setSavedSegments([]);
    // 清空画布和背景
    const canvas = canvasInstanceRef.current;
    if (canvas) {
      canvas.clear();
      canvas.setBackgroundImage('', canvas.renderAll.bind(canvas));
    }
    if (maskCanvasRef.current) {
      maskCanvasRef.current.clear();
    }
    if (segCanvasRef.current) {
      segCanvasRef.current.clear();
    }
    setHasBackground(false);
    originalImageRef.current = null;
    setExtractedImage(null);
    setSegmentationResult(null);
    setSupplementImageUrl(null);
    setSegmentationMask(null);
    setHoveredClass(null);
    setHistory([]);
    setHistoryIndex(-1);
    message.success('已清空所有分割结果和历史记录');
  };

  // 单个删除分割图片
  const handleDeleteSegment = (id: string) => {
    const segment = savedSegments.find(seg => seg.id === id);
    setSavedSegments(prev => prev.filter(segment => segment.id !== id));

    // 如果画布上显示的就是这张图片，则清空画布
    if (segment && canvasInstanceRef.current) {
      const canvas = canvasInstanceRef.current;
      // 检查画布上的图片对象
      const imageObjects = canvas.getObjects().filter(obj => obj.type === 'image') as fabric.Image[];
      if (imageObjects.length === 1) {
        const imgObj = imageObjects[0];
        const imgSrc = (imgObj.getElement() as HTMLImageElement).src;
        if (imgSrc === segment.url) {
          canvas.clear();
          setHasBackground(false);
          setExtractedImage(null);
          setSegmentationResult(null);
          if (maskCanvasRef.current) maskCanvasRef.current.clear();
          originalImageRef.current = null;
          setFileList([]);
        }
      }
    }
  };

  // 应用透明橡皮擦
  const applyTransparentEraser = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) {
      message.error('画布未初始化');
      return;
    }
    
    console.log('开始应用橡皮擦...');

    // 获取所有透明橡皮擦路径
    const transparentEraserPaths = canvas.getObjects().filter((obj: fabric.Object) => {
      return obj.type === 'path' && 
        ((obj as any).stroke === 'rgba(0, 255, 255, 0.3)' || 
         (obj as any).fill === 'rgba(0, 255, 255, 0.3)');
    }) as fabric.Path[];

    console.log(`找到 ${transparentEraserPaths.length} 个橡皮擦路径`);

    // 如果没有橡皮擦路径，提示用户
    if (transparentEraserPaths.length === 0) {
      message.warning('请先使用透明橡皮擦工具涂抹要擦除的区域');
      return;
    }

    try {
      let sourceImageUrl = '';
      
      // 如果存在抠图结果，优先使用它作为源
      if (extractedImage) { 
        if (extractedImage) {
          setPreviousImageStates(prev => [...prev, extractedImage]);
          console.log('已保存当前图像状态用于撤销');
        }
        
        sourceImageUrl = extractedImage;
      } else {
        message.warning('没有可擦除的图像，请先分割图像');
        return;
      }
      
      // 创建一个新的Image对象来加载当前源图像
      const currentSourceImg = new Image();
      currentSourceImg.crossOrigin = 'anonymous';
      
      currentSourceImg.onload = () => {
        console.log('源图像加载成功，尺寸:', currentSourceImg.width, 'x', currentSourceImg.height);
        
        // 使用图像的原始尺寸创建临时画布
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = currentSourceImg.naturalWidth;
        tempCanvas.height = currentSourceImg.naturalHeight;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
        if (!tempCtx) {
          message.error('无法创建临时画布');
          return;
        }
        tempCtx.drawImage(currentSourceImg, 0, 0, tempCanvas.width, tempCanvas.height);
        
        // 获取画布上的背景图像用于计算比例
        const backgroundImage = canvas.backgroundImage as fabric.Image;
        if (!backgroundImage) {
          message.error('无法获取画布背景图像');
          return;
        }
        const bgLeft = backgroundImage.left || 0;
        const bgTop = backgroundImage.top || 0;
        const bgScaleX = backgroundImage.scaleX || 1;
        const bgScaleY = backgroundImage.scaleY || 1;
        const displayWidth = (backgroundImage.width || tempCanvas.width) * bgScaleX;
        const displayHeight = (backgroundImage.height || tempCanvas.height) * bgScaleY;
        
        console.log(`显示尺寸: ${displayWidth}x${displayHeight}, 位置: (${bgLeft}, ${bgTop}), 缩放: (${bgScaleX}, ${bgScaleY})`);
        // 计算从画布坐标到原始图像坐标的变换比例
        const canvasToImageScaleX = tempCanvas.width / displayWidth;
        const canvasToImageScaleY = tempCanvas.height / displayHeight;
        
        console.log(`变换比例: X=${canvasToImageScaleX}, Y=${canvasToImageScaleY}`);
        // 在临时画布上绘制擦除区域
        tempCtx.globalCompositeOperation = 'destination-out';
        
        // 转换并绘制每个橡皮擦路径
        transparentEraserPaths.forEach((path, index) => {
          console.log(`处理橡皮擦路径 ${index+1}/${transparentEraserPaths.length}`);
          tempCtx.save();
          
          // 设置擦除样式
          tempCtx.lineWidth = brushSize * canvasToImageScaleX * 2; 
          tempCtx.lineCap = 'round';
          tempCtx.lineJoin = 'round';
          
          // 调整坐标系以匹配图像位置
          tempCtx.translate(-bgLeft * canvasToImageScaleX, -bgTop * canvasToImageScaleY);
          
          // 绘制路径
          if (path.path) {
            tempCtx.beginPath();
            const pathData = path.path as unknown as (Array<[string, ...number[]]>);
            
            for (let i = 0; i < pathData.length; i++) {
              const point = pathData[i];
              if (point[0] === 'M') {
                tempCtx.moveTo(point[1] * canvasToImageScaleX, point[2] * canvasToImageScaleY);
              } else if (point[0] === 'L') {
                tempCtx.lineTo(point[1] * canvasToImageScaleX, point[2] * canvasToImageScaleY);
              } else if (point[0] === 'Q') {
                tempCtx.quadraticCurveTo(
                  point[1] * canvasToImageScaleX, 
                  point[2] * canvasToImageScaleY,
                  point[3] * canvasToImageScaleX, 
                  point[4] * canvasToImageScaleY
                );
              } else if (point[0] === 'C') {
                tempCtx.bezierCurveTo(
                  point[1] * canvasToImageScaleX, 
                  point[2] * canvasToImageScaleY,
                  point[3] * canvasToImageScaleX, 
                  point[4] * canvasToImageScaleY,
                  point[5] * canvasToImageScaleX, 
                  point[6] * canvasToImageScaleY
                );
              }
            }
            
            tempCtx.stroke();
          }
          
          tempCtx.restore();
        });
        
        // 获取擦除后的图像
        const erasedImageURL = tempCanvas.toDataURL('image/png', 1.0);
        // 显示在右侧预览区域，更新分割结果
        setExtractedImage(erasedImageURL);
        setHasBackground(true);
        
        // 将处理后的图片添加到保存的分割列表
        const timestamp = Date.now();
        const newSegment = {
          id: `eraser-result-${timestamp}`,
          url: erasedImageURL,
          className: `擦除结果-${timestamp.toString().slice(-4)}`
        };
        setSavedSegments(prev => [...prev, newSegment]);
        
        // 清除原来的橡皮擦路径
        transparentEraserPaths.forEach(path => {
          canvas.remove(path);
        });
        
        // 同步更新左侧画布的背景图像
        fabric.Image.fromURL(erasedImageURL, (img) => {
          // 使用与原背景图像相同的位置和缩放
          img.set({
            left: bgLeft,
            top: bgTop,
            scaleX: bgScaleX,
            scaleY: bgScaleY,
            selectable: false,
            evented: false
          });
          
          // 替换左侧画布的背景图像
          canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
          
        });
        setDrawingHistory([]);
        console.log('已清空绘图历史');    
        // 保存状态
        saveCanvasState();
      };  
      currentSourceImg.onerror = (err) => {
        console.error('加载源图像失败:', err);
        message.error('加载源图像失败，请重试');
      };
      currentSourceImg.src = sourceImageUrl;
    } catch (error) {
      console.error('应用橡皮擦失败:', error);
      message.error('应用橡皮擦失败，请重试');
    }
  };

  // 专门用于处理分割数据的点击交互启用函数
  const enableClickSegmentationWithData = (segmentedImageData: string) => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) {
      message.error('画布未初始化');
      return;
    }
    
    if (!segmentedImageData) {
      message.warning('分割图像数据为空');
      return;
    }
    
    canvas.off('mouse:down');
    setDrawMode('aiClick');
    canvas.defaultCursor = 'pointer';
    setSegmentationResult(segmentedImageData);
    
    canvas.on('mouse:down', (options) => {
      if (!canvas.backgroundImage) {
        message.warning('请先上传图片');
        return;
      }
      
      const pointer = canvas.getPointer(options.e);
      const bgImage = canvas.backgroundImage as fabric.Image;
      
      const imgElement = bgImage.getElement() as HTMLImageElement;
      const scaleX = bgImage.scaleX || 1;
      const scaleY = bgImage.scaleY || 1;
      const left = bgImage.left || 0;
      const top = bgImage.top || 0;
      const imgWidth = imgElement.width * scaleX;
      const imgHeight = imgElement.height * scaleY;
      
      if (
        pointer.x < left || pointer.x > left + imgWidth ||
        pointer.y < top || pointer.y > top + imgHeight
      ) {
        message.info('请点击图像区域');
        return;
      }
      
      if (segmentedImageData) {
        setExtractedImage(segmentedImageData);
        setSavedSegments((prev) => {
          const exists = prev.some(item => item.url === segmentedImageData);
          if (exists) return prev;
          
          return [
            ...prev, 
            { 
              id: `segment-click-${Date.now()}`, 
              url: segmentedImageData, 
              className: '点击选择' 
            }
          ];
        });
      } else {
        message.warning('未获取到分割结果');
      }
    });
  };

  // 处理原始分割数据的点击交互
  const enableClickSegmentationWithRawData = (segmentedImageData: string) => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) {
      message.error('画布未初始化');
      return;
    }
    
    if (!segmentedImageData) {
      message.warning('分割图像数据为空');
      return;
    }
    
    canvas.off('mouse:down');
    setDrawMode('aiClick');
    canvas.defaultCursor = 'pointer';
    setSegmentationResult(segmentedImageData);
    
    canvas.on('mouse:down', async () => {
      try {
        if (!canvas.backgroundImage) {
          message.warning('请先上传图片');
          return;
        }
        
        setExtractedImage(segmentedImageData);
        setSavedSegments((prev) => {
          const isDuplicate = prev.some(item => item.url === segmentedImageData);
          if (isDuplicate) return prev;
          
          return [
            ...prev,
            {
              id: `segment-click-${Date.now()}`,
              url: segmentedImageData,
              className: '分割结果'
            }
          ];
        });
      } catch (error) {
        message.error('选择区域失败');
      }
    });
  };
  // 新增函数：提取手绘区域并生成透明 PNG
  const handleSupplementExtract = () => {
    const originalCanvas = canvasInstanceRef.current!;  // 使用正确的 Canvas
    if (!originalCanvas || !originalCanvas.backgroundImage) {
      message.warning('请先上传背景图片');
      return;
    }

    // 获取所有红色画笔路径
    const supplementPaths = originalCanvas.getObjects().filter((obj: fabric.Object) => {
      return obj.type === 'path' && 
        ((obj as any).stroke === 'rgba(255, 0, 0, 0.5)' || 
         (obj as any).fill === 'rgba(255, 0, 0, 0.5)');
    }) as fabric.Path[];

    if (supplementPaths.length === 0) {
      message.warning('请先用红色画笔涂抹要补充的区域');
      return;
    }

    // 获取背景图片信息
    const bgImage = originalCanvas.backgroundImage as fabric.Image;
    const imgElement = bgImage.getElement() as HTMLImageElement;

    // 获取图片实际显示尺寸
    const scaleX = bgImage.scaleX || 1;
    const scaleY = bgImage.scaleY || 1;
    const displayWidth = (bgImage.width || imgElement.width) * scaleX;
    const displayHeight = (bgImage.height || imgElement.height) * scaleY;
    const left = bgImage.left || 0;
    const top = bgImage.top || 0;

    // 创建临时画布 - 使用图片实际尺寸
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = displayWidth;
    tempCanvas.height = displayHeight;
    const ctx = tempCanvas.getContext('2d');

    if (!ctx) {
      message.error('无法创建临时画布');
      return;
    }

    // 绘制背景图像，位置和大小与画布上显示一致
    ctx.drawImage(
      imgElement,
      0, 0, imgElement.width, imgElement.height,
      0, 0, displayWidth, displayHeight
    );

    // 创建蒙版画布 (用于标记涂抹区域)
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = displayWidth;
    maskCanvas.height = displayHeight;
    const maskCtx = maskCanvas.getContext('2d');

    if (!maskCtx) {
      message.error('无法创建蒙版画布');
      return;
    }

    // 初始化蒙版为黑色背景 (表示未涂抹的区域)
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);

    // 使用白色绘制所有红色画笔涂抹的区域
    drawPathsOnMask(maskCtx, supplementPaths, 'white', left, top);

    // 获取图像数据
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

    // 逐像素处理图像数据
    for (let i = 0; i < imageData.data.length; i += 4) {
      // 如果蒙版对应位置的像素不是白色(涂抹区域)，则将原图对应位置设为透明
      if (maskData.data[i] < 200) { // 判断为黑色区域（未涂抹）
        imageData.data[i+3] = 0; // 设置alpha通道为0（完全透明）
      }
    }

    // 将处理后的图像数据放回画布
    ctx.putImageData(imageData, 0, 0);

    // 将结果转为数据URL并保存到状态
    const supplementImageUrl = tempCanvas.toDataURL('image/png', 1.0);
    setSupplementImageUrl(supplementImageUrl);
  };

  // 简化的叠加功能，专注于核心工作流程
  const handleExtractAndOverlay = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas || !canvas.backgroundImage) {
      message.warning('请先上传背景图片');
      return;
    }

    // 获取所有红色画笔路径
    const brushPaths = canvas.getObjects().filter((obj: fabric.Object) => {
      return obj.type === 'path' && 
        ((obj as any).stroke === 'rgba(255, 0, 0, 0.5)' || 
         (obj as any).fill === 'rgba(255, 0, 0, 0.5)');
    }) as fabric.Path[];

    if (brushPaths.length === 0) {
      message.warning('请先用红色画笔涂抹要提取的区域');
      return;
    }

    // 获取背景图像信息
    const bgImage = canvas.backgroundImage as fabric.Image;
    const imgElement = bgImage.getElement() as HTMLImageElement;
    // 使用原始图像尺寸，而不是显示尺寸
    const originalWidth = imgElement.naturalWidth;
    const originalHeight = imgElement.naturalHeight; 
    // 获取图像显示尺寸（用于路径缩放）
    const scaleX = bgImage.scaleX || 1;
    const scaleY = bgImage.scaleY || 1;
    const displayWidth = (bgImage.width || imgElement.width) * scaleX;
    const displayHeight = (bgImage.height || imgElement.height) * scaleY;
    const left = bgImage.left || 0;
    const top = bgImage.top || 0;
    // 创建使用原始尺寸的临时画布
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = originalWidth;
    tempCanvas.height = originalHeight;
    const ctx = tempCanvas.getContext('2d');

    if (!ctx) {
      message.error('无法创建临时画布');
      return;
    }

    ctx.drawImage(imgElement, 0, 0, originalWidth, originalHeight);
    // 创建相同尺寸的蒙版画布
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = originalWidth;
    maskCanvas.height = originalHeight;
    const maskCtx = maskCanvas.getContext('2d');

    if (!maskCtx) {
      message.error('无法创建蒙版画布');
      return;
    }

    // 初始化蒙版为黑色（未涂抹的区域）
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    // 计算显示尺寸与原始尺寸之间的缩放因子
    const pathScaleX = originalWidth / displayWidth;
    const pathScaleY = originalHeight / displayHeight;
    // 在蒙版上用白色绘制画笔路径，应用缩放
    maskCtx.fillStyle = 'white';
    maskCtx.strokeStyle = 'white';
    maskCtx.lineWidth = brushSize * pathScaleX; // 缩放画笔大小
    maskCtx.lineCap = 'round';
    maskCtx.lineJoin = 'round';

    // 手动缩放并绘制每个路径
    brushPaths.forEach(path => {
      maskCtx.save();
      maskCtx.translate(-left * pathScaleX, -top * pathScaleY); 
      if (path.path) {
        const pathData = path.path as unknown as (Array<[string, ...number[]]>);
        maskCtx.beginPath();
        
        for (let i = 0; i < pathData.length; i++) {
          const point = pathData[i];
          if (point[0] === 'M') {
            maskCtx.moveTo(point[1] * pathScaleX, point[2] * pathScaleY);
          } else if (point[0] === 'L') {
            maskCtx.lineTo(point[1] * pathScaleX, point[2] * pathScaleY);
          } else if (point[0] === 'Q') {
            maskCtx.quadraticCurveTo(
              point[1] * pathScaleX, point[2] * pathScaleY, 
              point[3] * pathScaleX, point[4] * pathScaleY
            );
          } else if (point[0] === 'C') {
            maskCtx.bezierCurveTo(
              point[1] * pathScaleX, point[2] * pathScaleY,
              point[3] * pathScaleX, point[4] * pathScaleY,
              point[5] * pathScaleX, point[6] * pathScaleY
            );
          }
        }
        
        maskCtx.stroke();
      }
      
      maskCtx.restore();
    });

    // 处理图像数据
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    // 处理像素 - 将未涂抹区域设为透明
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (maskData.data[i] < 200) { // 黑色区域（未涂抹）
        imageData.data[i+3] = 0; // 设为透明
      }
    }

    // 将处理后的数据放回画布
    ctx.putImageData(imageData, 0, 0);
    // 提取的画笔区域
    const brushSelectionUrl = tempCanvas.toDataURL('image/png', 1.0);
    // 检查是否已经有分割结果
    if (extractedImage) {
      setPreviousImageStates(prev => [...prev, extractedImage]);
      console.log('已保存当前图像状态用于撤销');
      // 在现有结果上叠加画笔选择，使用全分辨率
      const compositeCanvas = document.createElement('canvas');
      compositeCanvas.width = originalWidth;
      compositeCanvas.height = originalHeight;
      const compositeCtx = compositeCanvas.getContext('2d');

      if (!compositeCtx) {
        message.error('无法创建合成画布');
        return;
      }
      // 加载两张图像用于全分辨率合成
      const extractedImg = new Image();
      const brushSelectionImg = new Image();
      extractedImg.crossOrigin = 'anonymous';
      brushSelectionImg.crossOrigin = 'anonymous';

      let loadedImages = 0;
      const tryComposite = () => {
        if (loadedImages === 2) {
          // 确保使用最高的分辨率
          const maxWidth = Math.max(extractedImg.naturalWidth, brushSelectionImg.naturalWidth);
          const maxHeight = Math.max(extractedImg.naturalHeight, brushSelectionImg.naturalHeight);
          compositeCanvas.width = maxWidth;
          compositeCanvas.height = maxHeight;
          compositeCtx.drawImage(extractedImg, 0, 0, maxWidth, maxHeight);
          compositeCtx.drawImage(brushSelectionImg, 0, 0, maxWidth, maxHeight);
          const compositeImageUrl = compositeCanvas.toDataURL('image/png', 1.0);
          setExtractedImage(compositeImageUrl);
          const timestamp = Date.now();
          setSavedSegments(prev => [...prev, {
            id: `composite-${timestamp}`,
            url: compositeImageUrl,
            className: '高清叠加结果'
          }]);
          brushPaths.forEach(path => {
            canvas.remove(path);
          });
          canvas.renderAll();
        }
      };

      // 加载提取的图像
      extractedImg.onload = () => {
        loadedImages++;
        tryComposite();
      };
      // 加载画笔选择图像
      brushSelectionImg.onload = () => {
        loadedImages++;
        tryComposite();
      };
      // 设置图像源
      extractedImg.src = extractedImage;
      brushSelectionImg.src = brushSelectionUrl;
    } else {
      // 没有现有结果，只使用画笔选择
      setExtractedImage(brushSelectionUrl);
      
      // 保存到分割列表
      const timestamp = Date.now();
      setSavedSegments(prev => [...prev, {
        id: `brush-${timestamp}`,
        url: brushSelectionUrl,
        className: '手绘提取'
      }]);

      message.success('手绘区域提取成功');

      // 清理画布上的画笔路径
      brushPaths.forEach(path => {
        canvas.remove(path);
      });
      canvas.renderAll();
    }
  };

  // 添加函数以仅清除左侧画布上的标记（保留背景）
  const clearLeftCanvas = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return; 
    try {
      console.log('清除左侧画布标记开始');
      // 获取所有要移除的对象
      const objects = canvas.getObjects();
      console.log(`左侧画布对象数量: ${objects.length}`);
      // 记录画布上对象的类型用于调试
      objects.forEach((obj, index) => {
        console.log(`画布对象 ${index}: 类型=${obj.type}, 颜色=${(obj as any).stroke || (obj as any).fill || 'unknown'}`);
      });
      
      if (objects.length === 0) {
        message.info('左侧画布已经是空的');
        return;
      }
      // 仅移除路径对象
      const pathsToRemove = objects.filter(obj => obj.type === 'path');
      if (pathsToRemove.length === 0) {
        message.info('没有可删除的标记');
        return;
      }      
      console.log(`找到 ${pathsToRemove.length} 个可删除的路径对象`); 
      // 移除每个路径
      pathsToRemove.forEach(obj => {
        canvas.remove(obj);
      });
      canvas.renderAll();
      console.log('画布渲染完成');
      // 清除后保存状态
      saveCanvasState();
    } catch (error) {
      console.error('清除左侧画布错误:', error);
      message.error('清除左侧画布标记失败');
    }
  };
  // 添加函数仅清除右侧画布内容
  const clearRightCanvas = () => {
    if (!extractedImage) {
      message.info('右侧画布暂无内容');
      return;
    }
    setExtractedImage(null);
  };
  // 添加函数重置缩放级别
  const resetZoom = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) return;
    canvas.setZoom(1);
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    canvas.renderAll();
    setZoomLevel(1);
  };

  // 添加函数撤销上一步绘图操作（画笔或橡皮擦）
  const undoLastDrawing = () => {
    const canvas = canvasInstanceRef.current;
    if (!canvas) {
      message.error('画布未初始化');
      return;
    }
    // 获取画布上的所有对象
    const allObjects = canvas.getObjects();
    console.log(`画布上有 ${allObjects.length} 个对象`); 
    if (allObjects.length === 0) {
      message.info('没有可撤销的绘图操作');
      return;
    }   
    // 获取所有路径类型的对象
    const pathObjects = allObjects.filter(obj => obj.type === 'path') as fabric.Path[];
    console.log(`找到 ${pathObjects.length} 个路径对象`);  
    if (pathObjects.length === 0) {
      message.info('没有可撤销的绘图操作');
      return;
    }  
    try {
      const eraserPaths = pathObjects.filter(path => (path as any).stroke === 'rgba(0, 255, 255, 0.3)');
      console.log(`找到 ${eraserPaths.length} 个橡皮擦路径`);   
      let lastAddedPath: fabric.Path | null = null;
      let latestTimestamp = 0;
      const pathsToCheck = isMode(drawMode, 'transparentEraser') && eraserPaths.length > 0 
        ? eraserPaths 
        : pathObjects;
      
      // 遍历所有路径找出时间戳最大的
      pathsToCheck.forEach(path => {
        const uid = (path as any).uid;
        if (uid && parseInt(uid) > latestTimestamp) {
          latestTimestamp = parseInt(uid);
          lastAddedPath = path;
        }
      });     
      // 如果没有找到有uid的路径，使用数组中的最后一个
      if (!lastAddedPath) {
        lastAddedPath = pathsToCheck[pathsToCheck.length - 1];
        console.log('未找到带时间戳的路径，使用最后一个路径');
      } else {
        console.log(`找到最新路径，时间戳: ${latestTimestamp}`);
      }
      
      if (lastAddedPath) {
        const pathColor = (lastAddedPath as any).stroke || 'unknown';
        console.log(`准备移除最后一个绘制的路径: 颜色=${pathColor}, ID=${(lastAddedPath as any).uid || '无ID'}`);
        // 移除该对象
        canvas.remove(lastAddedPath);
        
        // 更新绘图历史（如果使用）
        if (drawingHistory.length > 0) {
          setDrawingHistory(prev => prev.filter(obj => obj !== lastAddedPath));
        }    
        // 确保画布刷新
        canvas.renderAll();
        // 保存画布状态
        saveCanvasState();
        
        message.success('撤回成功');
      } else {
        message.info('未找到可撤销的路径');
      }
    } catch (error) {
      console.error('撤销绘图操作失败:', error);
      message.error('撤销失败，请重试');
    }
  };

  // 添加函数用于撤销整个操作，恢复到之前的图像状态
  const undoImageOperation = () => {
    if (previousImageStates.length === 0) {
      message.info('没有可撤销的操作');
      return;
    }
    
    // 获取最后一个保存的图像状态
    const lastImageState = previousImageStates[previousImageStates.length - 1]; 
    
    // 恢复到上一个图像状态 
    setExtractedImage(lastImageState);
    // 如果当前是橡皮擦模式，则同时更新左侧画布
    if (drawMode === 'transparentEraser') {
      const canvas = canvasInstanceRef.current;
      if (canvas) {
        const bgImage = canvas.backgroundImage as fabric.Image;
        if (bgImage) {
          const bgLeft = bgImage.left || 0;
          const bgTop = bgImage.top || 0;
          const bgScaleX = bgImage.scaleX || 1;
          const bgScaleY = bgImage.scaleY || 1;
          fabric.Image.fromURL(lastImageState, (img) => {
            img.set({
              left: bgLeft,
              top: bgTop,
              scaleX: bgScaleX,
              scaleY: bgScaleY,
              selectable: false,
              evented: false
            });
            // 替换左侧画布的背景图像
            canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
            // 清除所有橡皮擦路径
            const eraserPaths = canvas.getObjects().filter((obj: fabric.Object) => {
              return obj.type === 'path' && 
                ((obj as any).stroke === 'rgba(0, 255, 255, 0.3)' || 
                 (obj as any).fill === 'rgba(0, 255, 255, 0.3)');
            });
            
            eraserPaths.forEach(path => {
              canvas.remove(path);
            });
            
            canvas.renderAll();
          });
        }
      }
    }
    
    // 从历史记录中移除已恢复的状态
    setPreviousImageStates(prev => prev.slice(0, prev.length - 1));
    
    // 清空绘图历史
    setDrawingHistory([]);
    
    message.success('撤回成功');
  };

  // OSS Upload Functions
  const getOSSData = async () => {
    try {
      // 检查本地存储是否有有效的OSS数据
      const cachedData = localStorage.getItem('OSSData');
      if (cachedData) {
        const parsedData = JSON.parse(cachedData) as OSSData;
        const expire = Number(parsedData.expire);
        
        if (expire > Date.now()) {
          setOssData(parsedData);
          return parsedData;
        }
      }
      
    // 如果没有缓存数据或已过期获取新的OSS配置
      return await initSts();
    } catch (error) {
      console.error('获取OSS数据失败:', error);
      message.error('获取OSS配置失败');
      return null;
    }
  };
  const initSts = async () => {
    try {
      const response = await fetch('https://mzbapi.hao-a.com/file/oss_sts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authen-Business': 'provider',
          'Authen-Mchno': '1000888',
          'Environment': 'production'
        },
      });
      
      const res = await response.json(); 
      if (res.status) {
        const credentials = res.data.credentials || {};
        const ossConfig = res.data.ossConfig || {};
        
        const resData = {
          expire: Date.parse(new Date(credentials?.expiration).toString()),
          host: ossConfig.host,
          domain: ossConfig.domain,
          accessKeyId: credentials.accessKeyId,
          signature: ossConfig.signature,
          policy: ossConfig.policy,
          regionId: ossConfig.regionId,
          securityToken: credentials.securityToken,
          bucket: ossConfig.bucket,
        };
        
        localStorage.setItem('OSSData', JSON.stringify(resData));
        setOssData(resData);
        return resData;
      } else {
        message.warning(res.message || '获取OSS配置失败');
        return null;
      }
    } catch (error) {
      console.error('初始化STS失败:', error);
      message.error('初始化OSS STS失败');
      return null;
    }
  };

  // 上传函数
  const uploadImageViaAPI = async (imageDataUrl: string) => {
    if (!imageDataUrl) {
      message.warning('请先生成分割图像');
      return;
    }

    try {
      setOssUploading(true);
      message.loading({ content: '正在上传图像...', key: 'ossUpload' });

      let imageToUpload = imageDataUrl;
      try {
        imageToUpload = await convertTransparentToWhite(imageDataUrl);
      } catch (error) {
        imageToUpload = imageDataUrl;
      }
      
      const blob = await fetch(imageToUpload).then(res => res.blob());
      const fileName = `segment_${Date.now()}.png`;
      const file = new File([blob], fileName, { type: 'image/png' });
      
      const formData = new FormData();
      formData.append('bucket', 'default');
      formData.append('media', 'image');
      formData.append('files', file);
      
      const response = await fetch('https://mzbapi.hao-a.com/file/oss_upload', {
        method: 'POST',
        headers: {
          'Accept': '*/*',
          'Authen-Business': 'provider',
          'Authen-Mchno': '1000888',
          'Environment': 'production',
        },
        body: formData,
      });
      
      const result = await response.json();
      
      if (result.status) {
        const uploadedUrl = result.data.url || result.data.input_url;
        setOssUploadUrl(uploadedUrl);
        
        const appUrl = `https://mzb.tuiyouquan.com/draw/fuzhuangshangshentongzhuang/6819a23e9e28e207ea5f0fce/?image_path=${encodeURIComponent(uploadedUrl)}`;
        
        message.success({ content: '上传成功，正在跳转...', key: 'ossUpload' });
        window.open(appUrl, '_blank');
      } else {
        message.error({ content: result.message || '上传失败', key: 'ossUpload' });
      }
    } catch (error) {
      message.error({ content: '上传失败，请重试', key: 'ossUpload' });
    } finally {
      setOssUploading(false);
    }
  };

  // OSS上传按钮
  const handleOssUpload = async () => {
    if (!extractedImage) {
      message.warning('请先分割图像');
      return;
    }
    uploadImageViaAPI(extractedImage);
  };

  // 执行分割
  const performAISegmentation = async (imgSrc: string) => {
    try {
      if (canvasInstanceRef.current) {
        canvasInstanceRef.current.off('mouse:down');
        canvasInstanceRef.current.defaultCursor = 'default';
      }
      setSegmentationResult(null);
      setSegmentationMask(null);
      setExtractedImage(null);
      setSegmentationLoading(true);
      setApiError({visible: false, message: ''});
      
      message.loading({ content: '正在分割...', key: 'segmentation' });
      
      // 转换图像数据
      let imageData = imgSrc;
      if (!imageData.startsWith('data:')) {
        try {
          const response = await fetch(imgSrc);
          const blob = await response.blob();
          imageData = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          throw new Error('图像转换失败，请确保图像可访问');
        }
      }
      
      // 调用接口
      try {
        const segmentedImageData = await segmentClothes(imageData);
        if (!segmentedImageData) {
          message.error({ content: '分割失败', key: 'segmentation' });
          setSegmentationLoading(false);
          setApiError({
            visible: true, 
            message: '服务器返回空结果，请检查网络连接并重试'
          });
          return;
        }
        
        // 保存分割结果
        setSegmentationResult(segmentedImageData);
        setDrawMode('aiClick');
        enableClickSegmentationWithRawData(segmentedImageData);
        
        message.success({ content: '分割完成，点击服装显示结果', key: 'segmentation' });
      } catch (error: any) {
        message.error({ 
          content: '分割服务暂时不可用', 
          key: 'segmentation',
          duration: 4
        });
        setApiError({
          visible: true, 
          message: '连接服务器失败，请检查网络。错误: ' + (error instanceof Error ? error.message : '未知错误')
        });
      }
    } catch (error) {
      message.error({ 
        content: '处理图像出错', 
        key: 'segmentation',
        duration: 4
      });
      setApiError({
        visible: true, 
        message: '处理图像出错: ' + (error instanceof Error ? error.message : '未知错误')
      });
    } finally {
      setSegmentationLoading(false);
    }
  };

  return (
    <div className="draw-page">
      <div className="tools-panel">
        <Card title="绘图工具" bordered={false}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Radio.Group value={drawMode} onChange={handleModeChange} buttonStyle="solid">
              <Tooltip title="智能选区 (点击交互)">
                <Radio.Button value="aiClick">👆</Radio.Button>
              </Tooltip>
            </Radio.Group>
            
            <div style={{ marginTop: '10px' }}>
              <div style={{ 
                padding: '12px', 
                backgroundColor: '#f0f9ff', 
                borderRadius: '4px',
                marginBottom: '12px',
                fontSize: '14px',
                lineHeight: '1.5'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                  操作指南:
                </div>
                <ol style={{ paddingLeft: '20px', margin: 0 }}>
                  <li>点击图像提取服装</li>
                  <li>若要添加更多区域，使用下方画笔工具并涂抹</li>
                  <li>点击"叠加提取"按钮添加涂抹区域</li>
                  <li>使用橡皮擦去除不需要的部分</li>
                </ol>
              </div>
              
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                marginBottom: '12px' 
              }}>
                <Tooltip title="画笔 (添加区域)">
                  <Button 
                    icon={<HighlightOutlined />}
                    onClick={() => handleModeChange({ target: { value: 'brush' } } as RadioChangeEvent)}
                    type={isMode(drawMode, 'brush') ? 'primary' : 'default'}
                    style={{ flex: 1, marginRight: '8px' }}
                  >
                    画笔
                  </Button>
                </Tooltip>
                <Tooltip title="橡皮擦 (擦除区域)">
                  <Button 
                    icon={<ClearOutlined />}
                    onClick={() => handleModeChange({ target: { value: 'transparentEraser' } } as RadioChangeEvent)}
                    type={isMode(drawMode, 'transparentEraser') ? 'primary' : 'default'}
                    style={{ flex: 1, marginRight: '8px' }}
                  >
                    橡皮擦
                  </Button>
                </Tooltip>
                <Tooltip title="移动 (拖动画布)">
                  <Button 
                    icon={<svg viewBox="64 64 896 896" focusable="false" data-icon="drag" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M909.3 506.3L781.7 405.6a7.23 7.23 0 00-11.7 5.7V476H548V254h64.8c6 0 9.4-7 5.7-11.7L517.7 114.7a7.14 7.14 0 00-11.3 0L405.6 242.3a7.23 7.23 0 005.7 11.7H476v222H254v-64.8c0-6-7-9.4-11.7-5.7L114.7 506.3a7.14 7.14 0 000 11.3l127.5 100.8c4.7 3.7 11.7.4 11.7-5.7V548h222v222h-64.8c-6 0-9.4 7-5.7 11.7l100.8 127.5c2.9 3.7 8.5 3.7 11.3 0l100.8-127.5c3.7-4.7.4-11.7-5.7-11.7H548V548h222v64.8c0 6 7 9.4 11.7 5.7l127.5-100.8a7.3 7.3 0 00.1-11.4z"></path></svg>}
                    onClick={() => handleModeChange({ target: { value: 'move' } } as RadioChangeEvent)}
                    type={isMode(drawMode, 'move') ? 'primary' : 'default'}
                    style={{ flex: 1 }}
                  >
                    移动
                  </Button>
                </Tooltip>
              </div>
              
              {isMode(drawMode, 'brush', 'transparentEraser', 'move') && (
                <Button 
                  onClick={() => handleModeChange({ target: { value: 'aiClick' } } as RadioChangeEvent)}
                  style={{ width: '100%', marginBottom: '12px' }}
                >
                  返回智能选区
                </Button>
              )}
              
              {isMode(drawMode, 'brush', 'transparentEraser', 'move') && (
                <div className="slider-container" style={{ marginBottom: '12px' }}>
                  <span>画笔大小:</span>
                  <Slider
                    min={1}
                    max={50}
                    value={brushSize}
                    onChange={handleBrushSizeChange}
                  />
                </div>
              )}
              
              {isMode(drawMode, 'transparentEraser', 'move') && (
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '12px'
                }}>
                  <Button 
                    type="primary" 
                    onClick={applyTransparentEraser}
                    style={{ flex: 1, marginRight: '8px' }}
                  >
                    应用擦除
                  </Button>
                  <Tooltip title="恢复上一版本">
                    <Button
                      onClick={undoImageOperation}
                      icon={<UndoOutlined />}
                      disabled={previousImageStates.length === 0}
                    />
                  </Tooltip>
                </div>
              )}

              {isMode(drawMode, 'brush', 'move') && (
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '12px'
                }}>
                  <Button 
                    type="primary" 
                    onClick={handleExtractAndOverlay}
                    disabled={!hasBackground}
                    style={{ flex: 1, marginRight: '8px' }}
                  >
                    叠加提取
                  </Button>
                  <Tooltip title="撤销">
                    <Button
                      onClick={undoImageOperation}
                      icon={<UndoOutlined />}
                      disabled={previousImageStates.length === 0}
                    />
                  </Tooltip>
                </div>
              )}
              
              {isMode(drawMode, 'aiClick') && (
                <div style={{ width: '100%' }}>
                  <Button 
                    type="primary" 
                    onClick={() => {
                      const canvas = canvasInstanceRef.current;
                      if (!canvas || !canvas.backgroundImage) {
                        message.warning('请先上传图片');
                        return;
                      }
                      const bgImage = canvas.backgroundImage as fabric.Image;
                      const imgElement = bgImage.getElement() as HTMLImageElement;
                      performAISegmentation(imgElement.src);
                    }}
                    style={{ width: '100%', marginBottom: '12px' }}
                  >
                    执行分割
                  </Button>
                </div>
              )}
            </div>
            
            <div style={{ 
              marginTop: '8px', 
              fontSize: '12px', 
              color: '#666',
              backgroundColor: '#f0f0f0',
              padding: '6px',
              borderRadius: '4px',
              textAlign: 'center',
              marginBottom: '12px'
            }}>
              提示: 使用鼠标滚轮可放大/缩小画布
            </div>
            
            <Space wrap>
              <Tooltip title="清除蒙版">
                <Button 
                  icon={<DeleteOutlined />} 
                  onClick={handleClear}
                />
              </Tooltip>
              <Tooltip title="下载">
                <Button 
                  icon={<DownloadOutlined />} 
                  onClick={handleDownload}
                />
              </Tooltip>
            </Space>
            
            <Upload
              name="image"
              listType="picture"
              fileList={fileList}
              onChange={handleUpload}
              beforeUpload={beforeUpload}
              maxCount={1}
              accept="image/*"
              onRemove={() => {
                handleUpload({ file: { status: 'removed' } });
              }}
              showUploadList={{ 
                showPreviewIcon: true, 
                showRemoveIcon: true,
                removeIcon: <DeleteOutlined 
                  title="删除图片并清除编辑"
                  style={{ color: '#ff4d4f' }}
                />
              }}
            >
              <Button 
                icon={<UploadOutlined />} 
                type="primary"
                size="large"
                style={{ width: '100%', marginTop: '8px' }}
              >
                上传图片
              </Button>
            </Upload>
            
            {extractedImage && (
              <div style={{ marginTop: '16px' }}>
                <Button 
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  onClick={handleOssUpload}
                  loading={ossUploading}
                  style={{ width: '100%' }}
                >
                  上传到服装上身
                </Button>
              </div>
            )}
          </Space>
        </Card>
      </div>

      <div className="canvas-container" style={{ 
        marginTop: '16px',
        border: '1px solid #ddd',
        backgroundColor: '#fff',
        display: 'flex',
        flexDirection: 'row',
        padding: '10px',
        gap: '20px',
        position: 'relative'
      }}>
        {modelLoading.loading && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.7)',
            zIndex: 100
          }}>
            <Spin size="large" />
            <div style={{ marginTop: '10px' }}>
              连接中 ({Math.round(modelLoading.progress * 100)}%)
            </div>
          </div>
        )}
        
        <div style={{ width: '800px', height: '600px', position: 'relative' }}>
          <canvas ref={canvasRef} />
          {zoomLevel !== 1 && (
            <div style={{ 
              position: 'absolute',
              top: '10px',
              right: '10px',
              padding: '4px 8px',
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '12px',
              zIndex: 100,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>缩放比例: {Math.round(zoomLevel * 100)}%</span>
              <Button 
                size="small" 
                onClick={resetZoom}
                type="link"
                style={{ color: '#fff', padding: '0 4px', marginLeft: '4px', fontSize: '12px' }}
              >
                重置
              </Button>
            </div>
          )}
          {hasBackground && isMode(drawMode, 'aiClick') && segmentationMask && (
            <div style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              padding: '5px 10px',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '16px',
              zIndex: 5
            }}>
              点击图片任意区域选择要提取的部分
            </div>
          )}
          {hasBackground && isMode(drawMode, 'aiClick') && segmentationResult && (
            <div style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              padding: '5px 10px',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '16px',
              zIndex: 5
            }}>
              点击图片查看分割结果
            </div>
          )}
          {hasBackground && isMode(drawMode, 'brush') && (
            <div style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              padding: '5px 10px',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: 'white',
              borderRadius: '4px',
              fontSize: '16px',
              zIndex: 5
            }}>
              使用画笔涂抹要添加的区域，然后点击"叠加提取"
            </div>
          )}
        </div>
        
        <div className="canvas-container" style={{ 
          width: '800px', 
          height: '600px',
          position: 'relative',
          backgroundColor: '#fff'
        }}>
          {hasBackground && extractedImage && (
            <>
              <img 
                src={extractedImage} 
                alt="抠图结果" 
                style={{ 
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain'
                }} 
              />
              {isMode(drawMode, 'aiClick') && hoveredClass !== null && segmenterRef.current && (
                <div style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  padding: '5px 10px',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '16px'
                }}>
                  当前选中: {segmenterRef.current.getClassNames()[hoveredClass]}
                </div>
              )}
              {isMode(drawMode, 'transparentEraser') && (
                <div style={{
                  position: 'absolute',
                  top: '10px',
                  left: '10px',
                  padding: '5px 10px',
                  backgroundColor: 'rgba(0, 0, 0, 0.7)',
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '16px',
                  zIndex: 5
                }}>
                  使用橡皮擦涂抹要擦除的区域
                </div>
              )}
            </>
          )}
          {(!extractedImage && hasBackground) && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              color: '#999',
              fontSize: '16px'
            }}>
              {isMode(drawMode, 'transparentEraser') 
                ? '请先分割出图像内容' 
                : segmentationResult 
                  ? '点击左侧图片显示分割结果'
                  : '请等待分割完成或点击左侧图片选择要提取的区域'}
            </div>
          )}
          {!hasBackground && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              color: '#999',
              fontSize: '16px'
            }}>
              请先上传图片
            </div>
          )}
          
          {segmentationLoading && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.7)',
              zIndex: 10
            }}>
              <Spin size="large" />
              <div style={{ marginTop: '16px' }}>
                执行分割中...
              </div>
            </div>
          )}
          
          {/* API错误提示 */}
          {apiError.visible && (
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              zIndex: 11
            }}>
              <div style={{ 
                backgroundColor: '#fff1f0', 
                border: '1px solid #ffa39e',
                padding: '16px',
                borderRadius: '4px',
                maxWidth: '80%',
                textAlign: 'center'
              }}>
                <div style={{ color: '#cf1322', marginBottom: '8px', fontWeight: 'bold' }}>
                  网络连接错误
                </div>
                <div style={{ marginBottom: '16px' }}>
                  {apiError.message}
                </div>
                <Button 
                  type="primary" 
                  onClick={() => {
                    setApiError({visible: false, message: ''});
                    if (canvasInstanceRef.current?.backgroundImage) {
                      const bgImage = canvasInstanceRef.current.backgroundImage as fabric.Image;
                      const imgElement = bgImage.getElement() as HTMLImageElement;
                      performAISegmentation(imgElement.src);
                    }
                  }}
                  danger
                >
                  重新尝试
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DrawPage; 