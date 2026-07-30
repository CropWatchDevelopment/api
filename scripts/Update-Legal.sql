  UPDATE public.legal_documents
     SET current_version = current_version + 1, effective_at = now(), updated_at = now()
   WHERE kind = 'eula';  -- or 'terms_of_service' / 'privacy_policy'