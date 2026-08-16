import { Meteors } from '@/components/ui/meteors'
import RegisterForm from './register-form'

export default function RegisterPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background text-foreground">
      <Meteors number={30} />
      <div className="relative z-10 w-full max-w-md space-y-8 p-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold">TrainingAI</h1>
          <p className="text-muted-foreground">Create an account</p>
        </div>
        <div className="rounded-xl border bg-card/50 p-8 shadow-xl backdrop-blur-sm">
          <RegisterForm />
        </div>
      </div>
    </div>
  )
}
