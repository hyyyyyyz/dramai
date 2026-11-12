/** Error copy keyed by the stable codes in @dramai/api's ERROR_CODES. */
export default {
  NETWORK_ERROR: 'Can’t reach the local server. Make sure it is still running',
  UNKNOWN: 'Something went wrong. Please try again',
  goProviders: 'Set up providers',

  BAD_REQUEST: 'The request was malformed',
  VALIDATION_ERROR: 'Some of what you entered isn’t valid. Check it and try again',
  UNAUTHORIZED: 'An access token is required: open the full address that ends in ?token=…',
  HOST_NOT_ALLOWED: 'This address is not allowed',
  CROSS_ORIGIN: 'The request came from another site and was refused',
  NOT_FOUND: 'That {{entity}} wasn’t found. It may have been deleted',
  PAYLOAD_TOO_LARGE: 'That is too large',
  INTERNAL: 'The server hit an internal error. Details are in the server log',
  NOT_IMPLEMENTED: 'This feature isn’t implemented yet',
  RESPONSE_SHAPE_MISMATCH: 'The server’s response doesn’t match the contract',

  ASSET_NAME_TAKEN: 'An asset with that name already exists',
  CANDIDATE_ALREADY_HANDLED: 'This candidate has already been handled',
  CANDIDATE_NOT_LINKED: 'This candidate isn’t linked, so there is nothing to undo',
  VERSION_EXISTS: 'That version already exists',
  KIND_MISMATCH: 'The candidate and the asset are of different kinds',
  UNKNOWN_STYLE_TEMPLATE: 'That style template doesn’t exist',
  MATERIAL_PARSE_FAILED:
    'This file couldn’t be parsed (legacy .doc isn’t supported; save it as .docx)',
  EPISODE_HAS_NO_SHOTS: 'This episode has no shots yet',
  EPISODE_HAS_NO_SOURCE: 'This episode has no source text to break down',
  ARTIFACT_INPUTS_BLOCKED: 'A required input is missing, so this can’t be generated yet',
  ARTIFACT_UPSTREAM_MISSING:
    'A required upstream product is missing. Finish the previous step first',

  STYLE_REFERENCE_MISSING:
    'A reference-image style needs an image uploaded first; it can’t be picked while creating a project, so create it and then upload',
  EDIT_INSTRUCTION_EMPTY: 'Editing a sheet needs an instruction saying what to change',
  ARTIFACT_NOT_STALE: '“Keep as is” only applies to products that are out of date',
  SHEET_TO_EDIT_MISSING: 'The sheet to edit has no current image yet. Generate one first',
  NOT_IN_TRASH: 'Only projects that are already in the trash can be purged',
  BUSY: 'A job is running. Wait for it to finish',
  MATERIAL_TOO_LARGE: 'The file is larger than 20 MB',
  UNSUPPORTED_MATERIAL:
    'This file type isn’t supported. Upload docx, txt, md, or a png / jpg / webp image',
  MATERIAL_IN_USE:
    'Episodes were planned from this material, so it can’t be deleted. Delete those episodes first',
  NO_SOURCE_MATERIAL: 'The project has no source text yet. Upload some first',
  NO_SHOTS: 'This episode has no shots yet',
  BREAKDOWN_WOULD_DISCARD_MEDIA:
    'Redoing the breakdown would discard generated images or videos. Use “append”, or delete those shots first',
  UNSUPPORTED_IMAGE: 'Only png, jpg and webp images are accepted',
  IMAGE_TOO_LARGE: 'The image is larger than 20 MB',
  UNKNOWN_VERSION: 'That version doesn’t exist',

  NO_LLM_PROVIDER: 'No language-model provider is selected. Set one up in Settings first',
  FFMPEG_MISSING: 'ffmpeg wasn’t found. Please install it',
  FFMPEG_INCOMPATIBLE: 'This ffmpeg lacks capabilities needed for composing',
  SUBTITLE_BURN_UNAVAILABLE: 'This ffmpeg can’t burn in subtitles. Use soft subtitles instead',
  TIMELINE_BLOCKED: 'The timeline has blocking issues to fix first',
  EXPORT_BLOCKED: 'The timeline has blocking issues, so it can’t be exported',
  NO_CUT: 'This episode has no rendered cut yet',
  UNSAFE_PATH: 'That file path isn’t valid',

  ASSET_NAME_INVALID: 'That asset name isn’t valid',
  NAME_INVALID: 'That name isn’t valid',
  ASSET_IN_USE: 'This asset is still referenced, so it can’t be deleted',
  VARIANT_NAME_INVALID: 'That variant name isn’t valid',
  VARIANT_NAME_DUPLICATE: 'Variant names must be unique',
  VARIANT_NAME_TAKEN: 'This asset already has a variant with that name',
  VARIANT_IN_USE: 'Shots still use this variant, so it can’t be deleted',
  COSTUME_NOT_FOUND: 'The chosen costume asset doesn’t exist',
  COSTUME_NOT_COSTUME_KIND: 'The chosen asset isn’t a costume',
  VOICE_NOT_ALLOWED: 'Only characters can have a voice',
  INVALID_TIMELINE: 'The timeline content isn’t valid',
  REVISION_CONFLICT: 'The timeline was changed elsewhere. Reload it and edit again',

  RUNNING_NOT_CANCELLABLE:
    'The job has started: calls already sent to the provider can’t be recalled and will run to completion',
  ALREADY_FINISHED: 'The job has already finished',
  NOT_FAILED: 'Only failed jobs can be handled this way',
  NOTHING_TO_RESUME: 'There is no upstream job to continue. Regenerate instead',
  NOT_RUNNING:
    '“Ignore result” only applies to running jobs; a queued job hasn’t cost anything yet, so just cancel it',
  NOT_APPLICABLE:
    'This job has no “ignore result” (only paid jobs that generate images, videos or voice-over do)',
  CONFIRM_RECHARGE_REQUIRED:
    'Regenerating may be charged again, so it needs your explicit confirmation',
}
