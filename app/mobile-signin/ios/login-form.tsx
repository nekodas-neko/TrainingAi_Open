"use client"
import { NativeLoginForm } from '../native/login-form'
export function IosLoginForm(props: { callbackUrl: string; state: string }) {
  return <NativeLoginForm {...props} signInPath="/mobile-signin/ios" />
}
