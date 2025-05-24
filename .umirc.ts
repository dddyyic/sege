import { defineConfig } from 'umi';

export default defineConfig({
  plugins: [
    require.resolve('@umijs/plugins/dist/antd'),
  ],
  title: 'Image Matting Tool',
  history: { type: 'browser' },
  base: '/draw/',
  publicPath: '/draw/',
  routes: [
    {
      exact: true,
      path: '/',
      redirect: '/draw'
    },
    {
      exact: true,
      path: '/draw',
      component: '@/pages/draw/index',
    }
  ],
  npmClient: 'yarn',
  antd: {},
  fastRefresh: true,
  mfsu: false,
});
