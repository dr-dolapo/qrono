import { useState, type FormEvent } from "react";
import { ApiError } from "./api";

/**
 * Form state for a submit-to-API form: busy flag, a top-level error and
 * per-field errors taken straight from the API's validation response.
 */
export function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  function handle(action: () => Promise<void>) {
    return async (e: FormEvent) => {
      e.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      setErrorCode(null);
      setFields({});
      try {
        await action();
      } catch (err) {
        if (err instanceof ApiError) {
          setFields(err.fields);
          setErrorCode(err.code ?? null);
          // When every problem is shown next to its field, skip the banner.
          if (Object.keys(err.fields).length === 0) setError(err.message);
        } else {
          setError("Something went wrong. Please try again.");
        }
      } finally {
        setBusy(false);
      }
    };
  }

  return { busy, error, errorCode, fields, setError, setFields, handle };
}
