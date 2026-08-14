import ReaderLabWorkspace from '@/components/ReaderLabWorkspace';

export const metadata = {
  title: '阅读工作区验证版 | AnchorRead',
  description: 'AnchorRead local-first 深度阅读工作区验证页',
};

export default function ReaderLabPage() {
  return (
    <main className="h-dvh min-h-[520px] overflow-hidden bg-[#f3f5f4]">
      <ReaderLabWorkspace layout="reader-lab" />
    </main>
  );
}
