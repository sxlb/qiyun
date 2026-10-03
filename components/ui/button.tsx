import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background",
    // 动效统一收敛到令牌（见 tailwind.config.ts）：
    // 悬停上浮 1px；按下回落到原位并轻微内缩（稳定按压态）。
    //
    // 为什么不用 keyframes 做按压反馈：animation 会整体接管 transform，
    // 悬停态的 translateY(-1px) 被丢弃 → 按下的瞬间按钮先"向上跳 1px"；
    // 且动画默认 fill-mode: none，180ms 后弹回 scale(1)，按住不动时还会再跳一次。
    // 改用过渡表达按压态：进出都平滑，且与悬停位移共用同一条 transform 链。
    //
    // 用 motion-safe: 前缀门控，而不是"先写动效再用 motion-reduce: 抵消"：
    // 两者同权重，胜负取决于 Tailwind 变体的输出顺序，改一次版本就可能反转。
    "motion-safe:transition-[color,background-color,border-color,box-shadow,transform] motion-safe:duration-200 motion-safe:ease-spring",
    "motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0 motion-safe:active:scale-[0.97]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // 实体按钮：上浮 1px + 投影（主色额外带一层辉光，强化"可点击"暗示）
        default: "bg-primary text-primary-foreground hover:bg-primary/90 hover:shadow-lift-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:shadow-lift",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground hover:shadow-lift",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-lift",
        // 轻量按钮：只做色彩反馈 + 内缩按压，不引入位移，避免密集工具栏抖动
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
