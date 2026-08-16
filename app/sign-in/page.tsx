import { Suspense } from "react";
import { Meteors } from "@/components/ui/meteors";
import { Typewriter } from "@/components/ui/typewriter-text";
import { GoogleSignIn } from "@/components/google-sign-in";
import EmailSignIn from "./email-sign-in";

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <Meteors number={30} />

      <div className="relative z-10 w-full max-w-md space-y-8 p-8 text-center">
        <div className="space-y-2">
          <h1 className="text-5xl font-bold">
            <Typewriter text="TrainingAI" speed={60} className="text-5xl font-bold text-gray-900" />
          </h1>
          <p className="text-muted-foreground text-xl">personal gym tracker</p>
        </div>

        <div className="space-y-4 rounded-xl border bg-card/50 p-8 shadow-xl backdrop-blur-sm">
          <GoogleSignIn />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card/50 px-2 text-muted-foreground backdrop-blur-sm">or</span>
            </div>
          </div>

          <Suspense>
            <EmailSignIn />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
