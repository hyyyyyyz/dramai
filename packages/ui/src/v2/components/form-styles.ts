/** Input / Textarea / Select 共用的外观：sunken 底、border-strong 边框、2px ring 焦点。 */
export const controlBase = [
  'w-full min-w-0 rounded-md border border-border-strong bg-sunken px-3 text-base text-foreground',
  'placeholder:text-subtle',
  'transition-colors duration-(--duration-fast) ease-standard',
  'hover:border-subtle',
  'focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-0',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border-strong',
  'aria-invalid:border-danger aria-invalid:focus-visible:outline-danger',
].join(' ')
