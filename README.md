The app's live link to test in the browser is: https://fabric-video-editor.vercel.app/

Do you need a custom editor? Get in touch with me at [Linked In](https://www.linkedin.com/in/amit-digga/)
Other: [Website](https://www.amitdigga.dev/) | [Twitter](https://twitter.com/AmitDigga) |

This was a hobby project. I will add support for other features in the future. Looking for backend/ffmpeg developers to help me generate video from Canvas in the backend.

# Fabric Video Editor

Fabric Video Editor is a video editor that runs in the browser. It is built with fabric.js, Next.js (a React framework), Tailwindcss, Mobx, and typescript.


## Samples

### 3. New Updated UI
<img width="1727" alt="Screenshot 2024-02-22 at 12 09 30 PM" src="https://github.com/AmitDigga/fabric-video-editor/assets/7884106/7246996c-259c-4730-ba19-af060cc94018">

### 2. The editor supports Animations and Effects

https://github.com/AmitDigga/fabric-video-editor/assets/7884106/61c32181-59c2-427c-b816-c51b40bf8bcc

### 1. Basic Working

https://github.com/AmitDigga/fabric-video-editor/assets/7884106/89674396-a0d3-45a3-b1cd-51097142b8f8



## Tech Explanation

todo


## Features

- [x] User can add
  - [x] Text
  - [x] Images
  - [x] Video
  - [x] Audio
- [x] User can change
  - [x] Canvas Background Color
- [x] Timeline
- [x] Export Video with Audio
- [x] Animations
- [x] Filters

## Main Issues

1. There might be a problem with audio handling
2. Exported video doesn't have a time duration
3. Exported videos have flickering issue

## Future Features

3. Properties Editing panel
4. Video Trimming

## NextJs Default Guide (Updated)

This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

### Getting Started

#### Setup

1. Clone the repo

2. Run the development server:

```bash
npm run dev
```

3. Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

#### Debugging

1. Run the development server:

```bash
npm run dev
```

2. Then run `Launch Chrome against localhost` in `Run and Debug` tab in VSCode

### Learn More

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

### Deploy on Vercel (Failing)

Failing because of 50MB function limit on Vercel. Node-Canvas is too big to be deployed on Vercel.

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.
