import Spinner from './Spinner';

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  onClick,
  type = 'button',
  className = '',
}) {
  const baseClasses = 'rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary: 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300 disabled:bg-stone-300 dark:disabled:bg-white/20 dark:disabled:text-stone-500',
    secondary: 'bg-stone-100 dark:bg-white/10 text-stone-900 dark:text-stone-100 hover:bg-stone-200 dark:hover:bg-white/15 border border-stone-300 dark:border-stone-700',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className} flex items-center justify-center gap-2`}
    >
      {loading && <Spinner size={size === 'sm' ? 'sm' : 'md'} />}
      {children}
    </button>
  );
}
