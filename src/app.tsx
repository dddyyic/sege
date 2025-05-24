import { ConfigProvider } from 'antd';
import zhCN from 'antd/lib/locale/zh_CN';

export function rootContainer(container: React.ReactNode) {
  return (
    <ConfigProvider locale={zhCN}>
      {container}
    </ConfigProvider>
  );
}
