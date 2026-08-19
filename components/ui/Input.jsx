export default function Input({
  type = 'text',
  value,
  onChange,
  placeholder,
  disabled = false,
  className = '',
  ...props
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-3 py-2 border border-stone-300 dark:border-stone-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-stone-900 dark:focus:ring-stone-100 disabled:bg-stone-100 dark:disabled:bg-white/10 disabled:cursor-not-allowed ${className}`}
      {...props}
    />
  );
}
