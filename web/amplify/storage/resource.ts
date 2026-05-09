import { defineStorage } from '@aws-amplify/backend';
import { generateSlides } from '../functions/generate-slides/resource';

/**
 * S3 bucket holding the generated `slides.md` for each job.
 *
 * `entity_id` here resolves to the Cognito identity id, so users only see
 * their own files. The Lambda has read+write so it can finalize the job
 * record and serve presigned URLs.
 *
 * NOTE: AgentCore Runtime's execution role lives outside Amplify and is
 * granted PutObject separately by the CDK stack.
 */
export const storage = defineStorage({
  name: 'slidesBucket',
  access: (allow) => ({
    'jobs/{entity_id}/*': [
      allow.entity('identity').to(['read']),
      allow.resource(generateSlides).to(['read', 'write']),
    ],
  }),
});
