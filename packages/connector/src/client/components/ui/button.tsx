import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors duration-200 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  {
    variants: {
      variant: {
        default:
          "bg-fg text-bg hover:opacity-90",
        destructive:
          "bg-destructive text-white hover:bg-destructive-hover",
        outline:
          "border border-line bg-transparent text-fg hover:bg-hover hover:border-line-hover",
        secondary:
          "bg-raised text-fg border border-line hover:bg-hover hover:border-line-hover",
        ghost:
          "text-secondary hover:text-fg hover:bg-hover",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        xs: "h-7 gap-1 rounded-md px-2.5 text-xs",
        sm: "h-8 gap-1.5 rounded-md px-3 text-xs",
        lg: "h-11 rounded-lg px-8 text-sm",
        icon: "size-9",
        "icon-xs": "size-7 rounded-md",
        "icon-sm": "size-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
