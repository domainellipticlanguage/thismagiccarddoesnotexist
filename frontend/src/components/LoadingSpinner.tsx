export function LoadingSpinner({ fullScreen = false, message }: { fullScreen?: boolean; message?: string }) {
  const spinner = (
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-neutral-700 border-t-gold-400 rounded-full animate-spin" />
      {message && <p className="text-sm text-neutral-400">{message}</p>}
    </div>
  );
  if (fullScreen) return <div className="flex items-center justify-center min-h-[60vh]">{spinner}</div>;
  return spinner;
}
