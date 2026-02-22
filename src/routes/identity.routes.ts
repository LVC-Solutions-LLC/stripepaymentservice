import { Router } from 'express';
import {
    createIdentitySession,
    createIdentitySessionSchema,
    getIdentitySession
} from '../controllers/identity.controller';
import { validate } from '../middlewares/validate';

const router = Router();

router.post(
    '/create-session',
    validate(createIdentitySessionSchema),
    createIdentitySession
);

router.get('/session/:sessionId', getIdentitySession);

export default router;
