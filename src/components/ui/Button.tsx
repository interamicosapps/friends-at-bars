import {
  ButtonHTMLAttributes,
  forwardRef,
  ReactElement,
  cloneElement,
} from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "outline" | "ghost" | "destructive";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "default" | "sm" | "lg";
  asChild?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      asChild = false,
      children,
      ...props
    },
    ref
  ) => {
    const buttonClasses = cn(
      "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none ring-offset-background",
      {
        "bg-primary text-primary-foreground hover:bg-primary/90":
          variant === "default",
        "border border-input hover:bg-accent hover:text-accent-foreground":
          variant === "outline",
        "hover:bg-accent hover:text-accent-foreground": variant === "ghost",
        "bg-destructive text-destructive-foreground hover:bg-destructive/90":
          variant === "destructive",
      },
      {
        "h-10 min-h-[44px] py-2 px-4": size === "default",
        "h-11 min-h-[44px] px-4 rounded-md": size === "sm",
        "h-11 px-8 rounded-md": size === "lg",
      },
      className
    );

    if (asChild && children) {
      return cloneElement(children as ReactElement, {
        className: buttonClasses,
        ref,
      });
    }

    return (
      <button className={buttonClasses} ref={ref} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export { Button };
