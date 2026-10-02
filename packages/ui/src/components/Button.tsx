import type { ButtonHTMLAttributes, Ref } from "react";

type Variant = "primary" | "outline" | "danger" | "link";

const VARIANTS: Record<Variant, string> = {
  primary: "h-11 rounded-full bg-btn px-5 text-btn-text hover:opacity-90",
  outline: "h-11 rounded-full border border-line bg-transparent px-4 text-text hover:bg-hair",
  danger: "h-11 rounded-full border border-warn bg-transparent px-4 text-warn hover:bg-hair",
  link: "min-h-11 bg-transparent px-0 text-text underline decoration-line underline-offset-4",
};

export function Button({
  variant = "outline",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type={type}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 font-sans text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
