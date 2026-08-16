import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@trainingai/shared/utils";
import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full items-end justify-end gap-2 py-4",
      from === "user" ? "is-user" : "is-assistant flex-row-reverse justify-end",
      "[&>div]:max-w-[90%] sm:[&>div]:max-w-[80%]",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "text-foreground flex flex-col gap-2 rounded-lg px-4 py-3 text-sm",
      "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground",
      "group-[.is-assistant]:bg-secondary group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    <div className="is-user:dark">{children}</div>
  </div>
);

export type MessageAvatarProps = ComponentProps<typeof Avatar> & {
  src?: string;
  name?: string;
  fallbackClassName?: string;
  children?: ReactNode;
};

export const MessageAvatar = ({
  src,
  name,
  className,
  fallbackClassName,
  children,
  ...props
}: MessageAvatarProps) => (
  <Avatar className={cn("ring-border size-8 ring", className)} {...props}>
    {src && <AvatarImage alt="" className="mt-0 mb-0" src={src} />}
    <AvatarFallback className={fallbackClassName}>
      {children ?? name?.slice(0, 2) ?? "ME"}
    </AvatarFallback>
  </Avatar>
);
