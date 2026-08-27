import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from '@vercel/analytics/next';
import { LocaleProvider } from '@/components/LocaleProvider';
import DiagramAgentBridge from '@/components/DiagramAgentBridge';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Anchor Read",
  description: "AI 驱动的专业文档阅读、概念理解与闪卡记忆工具",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        // Browser automation extensions may add data-* attributes before
        // React hydrates; suppress that external attribute-only mismatch.
        suppressHydrationWarning
      >
        {/* Automa marks the body before React hydrates; remove only its probe attribute. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
  document.body.removeAttribute("data-atm-ext-installed");
} catch (e) {}`,
          }}
        />
        {/* 主题防闪烁脚本（移植自 infinite-canvas whiteboard index.html，存储键改为 anchor-read-theme）：
            在首帧渲染前按本地存储应用 dark 类，默认浅色 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
  var t = localStorage.getItem("anchor-read-theme") === "dark" ? "dark" : "light";
  document.documentElement.classList.toggle("dark", t === "dark");
  document.documentElement.style.colorScheme = t;
} catch (e) {}`,
          }}
        />
        <LocaleProvider>
          <DiagramAgentBridge />
          {children}
        </LocaleProvider>
        {/* Vercel Web Analytics 仅在其托管平台有效；自托管部署时跳过，
            避免 /_vercel/insights/script.js 返回 404 */}
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  );
}
