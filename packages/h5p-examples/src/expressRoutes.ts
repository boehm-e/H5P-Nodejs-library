import express from 'express';
import s3Storage from './S3Storage';
import fs from 'fs';
import * as H5P from '@lumieducation/h5p-server';
import { exec } from 'child_process';
import decompress from 'decompress';

import {
    IRequestWithUser,
    IRequestWithLanguage
} from '@lumieducation/h5p-express';



const downloadContentFromS3 = async (s3ObjectName: string, contentId: string) => {
    const downloadUrl = await s3Storage.getPresignedUrl(s3ObjectName);
    if (!downloadUrl) return;

    const response = await fetch(downloadUrl);
    const buffer = await response.arrayBuffer();

    const zipPath = `./h5p/content/${contentId}.zip`;
    const extractPath = `./h5p/content/${contentId}`;

    await fs.promises.mkdir(extractPath, { recursive: true });
    await fs.promises.writeFile(zipPath, Buffer.from(buffer));

    await new Promise((resolve, reject) => {
        exec(`unzip ${zipPath} -d ${extractPath}`, (error) => {
            if (error) reject(error);
            resolve(true);
        });
    });

    const contentJsonPath = `${extractPath}/content/content.json`;
    const finalContentJsonPath = `${extractPath}/content.json`;

    await fs.promises.copyFile(contentJsonPath, finalContentJsonPath);

    // Clean up files in parallel
    const entries = await fs.promises.readdir(extractPath, { withFileTypes: true });
    const cleanupPromises = entries.map(entry => {
        const fullPath = `${extractPath}/${entry.name}`;
        if (entry.name !== 'h5p.json' && entry.name !== 'content.json') {
            return entry.isDirectory() 
                ? fs.promises.rm(fullPath, { recursive: true })
                : fs.promises.unlink(fullPath);
        }
    }).filter(Boolean);

    await Promise.all(cleanupPromises);
    await fs.promises.unlink(zipPath);

    return extractPath;
}
/**
 * @param h5pEditor
 * @param h5pPlayer
 * @param languageOverride the language to use. Set it to 'auto' to use the
 * language set by a language detector in the req.language property.
 * (recommended)
 */
export default function (
    h5pEditor: H5P.H5PEditor,
    h5pPlayer: H5P.H5PPlayer,
    languageOverride: string | 'auto' = 'auto'
): express.Router {
    const router = express.Router();

    router.get(
        `/s3/:s3ObjectName/:contentId`,
        async (req: IRequestWithUser, res) => {
            try {

                if (!req.params.contentId) return res.status(404).end();

                const contentFolder = `./h5p/content/${req.params.contentId}`;
                if (!fs.existsSync(contentFolder)) {
                    await downloadContentFromS3(req.params.s3ObjectName, req.params.contentId);
                }

                const h5pPage = await h5pPlayer.render(
                    req.params.contentId,
                    req.user,
                    languageOverride === 'auto'
                        ? (req.language ?? 'en')
                        : languageOverride,
                    {
                        showCopyButton: true,
                        showDownloadButton: true,
                        showFrame: true,
                        showH5PIcon: true,
                        showLicenseButton: true,
                        // We pass through the contextId here to illustrate how
                        // to work with it. Context ids allow you to have
                        // multiple user states per content object. They are
                        // purely optional. You should *NOT* pass the contextId
                        // to the render method if you don't need contextIds!
                        // You can test the contextId by opening
                        // `/h5p/play/XXXX?contextId=YYY` in the browser.
                        contextId:
                            typeof req.query.contextId === 'string'
                                ? req.query.contextId
                                : undefined,
                        // You can impersonate other users to view their content
                        // state by setting the query parameter asUserId.
                        // Example:
                        // `/h5p/play/XXXX?asUserId=YYY`
                        asUserId:
                            typeof req.query.asUserId === 'string'
                                ? req.query.asUserId
                                : undefined,
                        // You can disabling saving of the user state, but still
                        // display it by setting the query parameter
                        // `readOnlyState` to `yes`. This is useful if you want
                        // to review other users' states by setting `asUserId`
                        // and don't want to change their state.
                        // Example:
                        // `/h5p/play/XXXX?readOnlyState=yes`
                        readOnlyState:
                            typeof req.query.readOnlyState === 'string'
                                ? req.query.readOnlyState === 'yes'
                                : undefined
                    }
                );
                console.log("h5pPage", h5pPage)
                let h5pPageWithResize = h5pPage.replace('<head>', `<head>
<meta HTTP-EQUIV="CACHE-CONTROL" CONTENT="NO-CACHE">
<meta HTTP-EQUIV="PRAGMA" CONTENT="NO-CACHE">
<script>
  function sendHeight() {
    const height = document.querySelector('.h5p-content').scrollHeight;
    window.parent.postMessage({ type: 'setHeight', height: height }, '*');
  }
  
  window.addEventListener('load', function() {
    if (document.readyState === 'complete') {
      setTimeout(sendHeight, 1000);
    } else {
      window.addEventListener('load', () => setTimeout(sendHeight, 1000));
    }
    // setInterval(sendHeight, 5000);
  });
//   window.addEventListener('resize', sendHeight);
</script>
`);
                res.send(h5pPageWithResize);
                // res.send(h5pPage);
                res.status(200).end();
            } catch (error) {
                res.status(500).end(error.message);
            }
        }
    );

    router.get(
        `${h5pEditor.config.playUrl}/:contentId`,
        async (req: IRequestWithUser, res) => {
            try {
                console.log('contentId', req.params.contentId)
                const h5pPage = await h5pPlayer.render(
                    req.params.contentId,
                    req.user,
                    languageOverride === 'auto'
                        ? (req.language ?? 'en')
                        : languageOverride,
                    {
                        showCopyButton: true,
                        showDownloadButton: true,
                        showFrame: true,
                        showH5PIcon: true,
                        showLicenseButton: true,
                        // We pass through the contextId here to illustrate how
                        // to work with it. Context ids allow you to have
                        // multiple user states per content object. They are
                        // purely optional. You should *NOT* pass the contextId
                        // to the render method if you don't need contextIds!
                        // You can test the contextId by opening
                        // `/h5p/play/XXXX?contextId=YYY` in the browser.
                        contextId:
                            typeof req.query.contextId === 'string'
                                ? req.query.contextId
                                : undefined,
                        // You can impersonate other users to view their content
                        // state by setting the query parameter asUserId.
                        // Example:
                        // `/h5p/play/XXXX?asUserId=YYY`
                        asUserId:
                            typeof req.query.asUserId === 'string'
                                ? req.query.asUserId
                                : undefined,
                        // You can disabling saving of the user state, but still
                        // display it by setting the query parameter
                        // `readOnlyState` to `yes`. This is useful if you want
                        // to review other users' states by setting `asUserId`
                        // and don't want to change their state.
                        // Example:
                        // `/h5p/play/XXXX?readOnlyState=yes`
                        readOnlyState:
                            typeof req.query.readOnlyState === 'string'
                                ? req.query.readOnlyState === 'yes'
                                : undefined
                    }
                );
                // res.send(h5pPage);
                res.status(200).end();
            } catch (error) {
                res.status(500).end(error.message);
            }
        }
    );

    router.get(
        '/edit/:contentId',
        async (req: IRequestWithLanguage & IRequestWithUser, res) => {
            const page = await h5pEditor.render(
                req.params.contentId,
                languageOverride === 'auto'
                    ? (req.language ?? 'en')
                    : languageOverride,
                req.user
            );
            res.send(page);
            res.status(200).end();
        }
    );

    router.post('/edit/:contentId', async (req: IRequestWithUser, res) => {
        const contentId = await h5pEditor.saveOrUpdateContent(
            req.params.contentId.toString(),
            req.body.params.params,
            req.body.params.metadata,
            req.body.library,
            req.user
        );

        res.send(JSON.stringify({ contentId }));
        res.status(200).end();
    });

    router.get(
        '/new',
        async (req: IRequestWithLanguage & IRequestWithUser, res) => {
            const page = await h5pEditor.render(
                undefined,
                languageOverride === 'auto'
                    ? (req.language ?? 'en')
                    : languageOverride,
                req.user
            );
            res.send(page);
            res.status(200).end();
        }
    );

    router.post('/new', async (req: IRequestWithUser, res) => {
        if (
            !req.body.params ||
            !req.body.params.params ||
            !req.body.params.metadata ||
            !req.body.library ||
            !req.user
        ) {
            res.status(400).send('Malformed request').end();
            return;
        }
        const contentId = await h5pEditor.saveOrUpdateContent(
            undefined,
            req.body.params.params,
            req.body.params.metadata,
            req.body.library,
            req.user
        );

        res.send(JSON.stringify({ contentId }));
        res.status(200).end();
    });

    router.get('/delete/:contentId', async (req: IRequestWithUser, res) => {
        try {
            await h5pEditor.deleteContent(req.params.contentId, req.user);
        } catch (error) {
            res.send(
                `Error deleting content with id ${req.params.contentId}: ${error.message}<br/><a href="javascript:window.location=document.referrer">Go Back</a>`
            );
            res.status(500).end();
            return;
        }

        res.send(
            `Content ${req.params.contentId} successfully deleted.<br/><a href="javascript:window.location=document.referrer">Go Back</a>`
        );
        res.status(200).end();
    });

    return router;
}
