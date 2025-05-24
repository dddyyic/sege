/**
 * 服装分割API
 * 用于调用后端服务接口
 */
// 服装类别定义，还没实现
export enum ClothType {
  TOPS = 'tops',       // 上衣
  PANTS = 'pants',     // 裤子
  SKIRT = 'skirt',     // 裙子
  DRESS = 'dress',     // 连衣裙
  SHOES = 'shoes',     // 鞋子
  HAT = 'hat',         // 帽子
  BAG = 'bag',         // 包包
  COAT = 'coat'        // 外套
}
// 分割结果输出模式
export enum OutputMode {
  TRANSPARENT = 'transparent', // 透明背景
  WHITE_BG = 'whiteBK'         // 白色背景
}

/**
 * 后端接口地址
 */
// const SEGMENTATION_API_URL = 'http://121.43.109.152/api/segment';
const SEGMENTATION_API_URL = 'http://localhost:8861/api/segment';

/**
 * 对图像进行服饰分割
 * @param imageData 图像数据
 * @param outputMode 输出模式(透明或白底)
 * @returns 分割结果图像的base64
 */
export const segmentClothes = async (imageData: string, outputMode: OutputMode = OutputMode.TRANSPARENT): Promise<string | null> => {
  try {
    if (!imageData) throw new Error('图像数据为空');
    const base64Data = !imageData.startsWith('data:') ? `data:image/jpeg;base64,${imageData}` : imageData;

    const response = await fetch(SEGMENTATION_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        image: base64Data,
        output_mode: outputMode
      }),
    });

    if (!response.ok) throw new Error(`服务器响应错误: ${response.status}`);
    const data = await response.json();

    // 处理不同的返回格式
    if (data.image) return data.image;
    if (data.result?.image) return data.result.image;
    if (data.data?.result) return data.data.result;
    if (data.base64) return data.base64;
    
    if (data.url) {
      try {
        const imgResponse = await fetch(data.url);
        if (!imgResponse.ok) throw new Error(`下载图像失败: ${imgResponse.status}`);
        const blob = await imgResponse.blob();
        return await blobToBase64(blob);
      } catch (error) {
        return data.url;
      }
    }

    return null;
  } catch (error) {
    throw error;
  }
};

/**
 * 将Blob转换为Base64
 */
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * 将透明背景转换为白色背景
 * @param imageData 透明背景的图像数据
 * @returns 白色背景的图像数据
 */
export const convertTransparentToWhite = async (imageData: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法创建画布上下文'));
          return;
        }
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png', 1.0));
      };
      img.onerror = () => reject(new Error('加载图像失败'));
      img.src = imageData;
    } catch (error) {
      reject(error);
    }
  });
};