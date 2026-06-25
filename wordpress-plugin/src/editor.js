/**
 * Gutenberg editor integration for the `khaveeai/avatar` block.
 *
 * Phase 9 update: the block inspector now exposes 7 collapsible PanelBody
 * panels (Layout, Background, Lighting, Avatar, Camera, Voice & Behavior,
 * Chat Box) so a site owner can configure the avatar's visual appearance
 * and behaviour per-block without touching global settings.
 *
 * CRITICAL: this file imports NOTHING from @khaveeai/react,
 * @khaveeai/providers-openai-realtime, @khaveeai/core, or any other
 * khaveeai package — zero bundler entanglement with the SPA/mic/WebRTC
 * code is preserved (EMBED-05, RESEARCH Pitfall 3). The VOICE list below
 * is duplicated locally rather than imported for this reason.
 *
 * Phase 9 replaces the Phase 8 static ServerSideRender placeholder with a
 * true live preview. The preview is mounted by a SEPARATELY-ENQUEUED bundle
 * (khaveeai-preview.js, built by packages/wp-bundle/build.mjs, enqueued in
 * the editor via the enqueue_block_editor_assets hook) that owns its own
 * React 19 and renders the VRM/GLB scene WITHOUT mic, token, or realtime
 * provider — safe to run in the Gutenberg editor iframe. editor.js itself
 * never imports from @khaveeai/* (RESEARCH Pitfall 2: do not bundle React
 * twice; the preview bundle owns React, editor.js uses wp.element).
 *
 * The live editor preview reads config from the
 * data-khaveeai-preview-config attribute emitted on the mount-point div
 * below. editor.js rewrites this attribute on every edit() re-render
 * (Gutenberg re-renders on every setAttributes call AND on local state
 * changes), so the preview bundle's MutationObserver (Plan 09-03) always
 * sees fresh values including in-progress RangeControl drag positions.
 *
 * Uses @wordpress/element's createElement (not bare react/JSX) so WP
 * core's bundled React version is irrelevant to this file.
 *
 * Source lives in wordpress-plugin/src/ (NOT inside assets/) so that
 * @wordpress/scripts' webpack `output.clean` never deletes this source
 * file — assets/ is build OUTPUT only.
 */

import { registerBlockType } from '@wordpress/blocks';
import { createElement, useState, useRef, useEffect } from '@wordpress/element';
import {
	InspectorControls,
	MediaUpload,
	MediaUploadCheck,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	PanelBody,
	SelectControl,
	TextareaControl,
	Button,
	RangeControl,
	ToggleControl,
	ColorPalette,
	TextControl,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import metadata from './block.json';

/**
 * OpenAI Realtime voice enum (D-04). Duplicated here, NOT imported from
 * the khaveeai core package, to guarantee zero bundler entanglement with
 * the SPA. Source of truth: packages/core/src/types/realtime.ts voice union /
 * wordpress-plugin/includes/Admin/SettingsPage.php::VOICES.
 */
const VOICES = [
	'alloy',
	'ash',
	'ballad',
	'coral',
	'echo',
	'sage',
	'shimmer',
	'verse',
	'marin',
	'cedar',
];

const VOICE_OPTIONS = [
	{ label: __( '(using global default)', 'khaveeai' ), value: '' },
	...VOICES.map( ( voice ) => ( { label: voice, value: voice } ) ),
];

const CAMERA_PRESET_OPTIONS = [
	{ label: __( '(using global default)', 'khaveeai' ), value: '' },
	{ label: __( 'Front', 'khaveeai' ), value: 'front' },
	{ label: __( 'Left Angle', 'khaveeai' ), value: 'left-angle' },
	{ label: __( 'Right Angle', 'khaveeai' ), value: 'right-angle' },
	{ label: __( 'Wide', 'khaveeai' ), value: 'wide' },
];

const BG_TYPE_OPTIONS = [
	{ label: __( '(using global default)', 'khaveeai' ), value: '' },
	{ label: __( 'Color', 'khaveeai' ), value: 'color' },
	{ label: __( 'Image', 'khaveeai' ), value: 'image' },
];

const CHAT_PLACEMENT_OPTIONS = [
	{ label: __( 'Beside avatar', 'khaveeai' ), value: 'beside' },
	{ label: __( 'Below avatar', 'khaveeai' ), value: 'below' },
];

function Edit( { attributes, setAttributes } ) {
	const {
		voice, instructions, avatar,
		containerWidth, containerHeight, fullWidth,
		bgType, bgColor, bgTransparent, bgImageId,
		lightIntensity,
		avatarScale, avatarOffsetX, avatarOffsetY,
		cameraPreset,
		chatShow, chatPlacement,
	} = attributes;

	const blockProps = useBlockProps();

	// ── Editor-only local state (not persisted as block attributes) ──────
	// previewTalking drives a mouth-animation demo in the editor preview.
	// It is NOT a block attribute — it only lives for the duration of the
	// editing session and flows into data-khaveeai-preview-config JSON.
	const [ previewTalking, setPreviewTalking ] = useState( false );

	// ── RangeControl undo-spam mitigation (RESEARCH Pitfall 4) ──────────
	// setAttributes writes the Gutenberg undo stack. Firing it on every
	// pixel of a drag produces 50+ undo entries per slider interaction.
	// Pattern: maintain local React state for the displayed slider value so
	// the handle moves smoothly; debounce the actual setAttributes call at
	// ~50ms so only the settled value lands in the undo stack.
	//
	// data-khaveeai-preview-config (below) reads from live.* so the preview
	// bundle always reflects the current drag position without waiting for
	// the debounced commit. (UI-SPEC §Interaction-States "Preview — config
	// reactivity lag: last-applied value wins; no debouncing of slider input
	// beyond what R3F's frame loop already provides" — this no-debounce rule
	// applies to the PREVIEW RENDERING; setAttributes persistence DOES need
	// debounce to protect the undo stack.)
	const [ live, setLive ] = useState( {
		containerWidth,
		containerHeight,
		lightIntensity,
		avatarScale,
		avatarOffsetX,
		avatarOffsetY,
	} );
	const debounceRef = useRef( {} );

	// Sync local state back from attributes on undo/redo so the slider
	// snaps to the undone value when the author uses Ctrl+Z.
	useEffect( () => {
		setLive( ( prev ) => ( {
			...prev,
			containerWidth,
			containerHeight,
			lightIntensity,
			avatarScale,
			avatarOffsetX,
			avatarOffsetY,
		} ) );
	}, [ containerWidth, containerHeight, lightIntensity, avatarScale, avatarOffsetX, avatarOffsetY ] );

	/**
	 * Update local slider state immediately (smooth drag) and schedule a
	 * debounced setAttributes call (~50ms trailing) so the undo stack only
	 * gets the settled value.
	 *
	 * @param {string} key      - Block attribute key (camelCase).
	 * @param {number} value    - New slider value.
	 */
	function debouncedAttr( key, value ) {
		setLive( ( prev ) => ( { ...prev, [ key ]: value } ) );
		clearTimeout( debounceRef.current[ key ] );
		debounceRef.current[ key ] = setTimeout( () => {
			setAttributes( { [ key ]: value } );
		}, 50 );
	}

	// ── Preview config JSON (emitted on the mount-point div) ─────────────
	// All 16 persisted attributes + the editor-only previewTalking flag.
	// live.* overrides the attribute values for the 6 RangeControls so the
	// preview bundle sees the in-progress drag value without waiting for the
	// debounced setAttributes commit.
	const previewConfig = JSON.stringify( {
		voice,
		instructions,
		avatar,
		containerWidth:  live.containerWidth,
		containerHeight: live.containerHeight,
		fullWidth,
		bgType,
		bgColor,
		bgTransparent,
		bgImageId,
		lightIntensity:  live.lightIntensity,
		avatarScale:     live.avatarScale,
		avatarOffsetX:   live.avatarOffsetX,
		avatarOffsetY:   live.avatarOffsetY,
		cameraPreset,
		chatShow,
		chatPlacement,
		previewTalking,
	} );

	return createElement(
		'div',
		blockProps,
		// ── Inspector panels ──────────────────────────────────────────────
		createElement(
			InspectorControls,
			null,

			// ── Panel 1 — Layout ─────────────────────────────────────────
			createElement(
				PanelBody,
				{ title: __( 'Layout', 'khaveeai' ), initialOpen: true },
				createElement( RangeControl, {
					label: __( 'Container width (px)', 'khaveeai' ),
					help: __( 'Leave blank to use the global default.', 'khaveeai' ),
					value: live.containerWidth > 0 ? live.containerWidth : undefined,
					min: 200,
					max: 1200,
					onChange: ( value ) => debouncedAttr( 'containerWidth', value ),
				} ),
				createElement( RangeControl, {
					label: __( 'Container height (px)', 'khaveeai' ),
					help: __( 'Leave blank to use the global default.', 'khaveeai' ),
					value: live.containerHeight > 0 ? live.containerHeight : undefined,
					min: 200,
					max: 1200,
					onChange: ( value ) => debouncedAttr( 'containerHeight', value ),
				} ),
				createElement( ToggleControl, {
					label: __( 'Full-width', 'khaveeai' ),
					help: __( 'Stretch the avatar to the full width of its area.', 'khaveeai' ),
					checked: fullWidth,
					onChange: ( value ) => setAttributes( { fullWidth: value } ),
				} )
			),

			// ── Panel 2 — Background ─────────────────────────────────────
			createElement(
				PanelBody,
				{ title: __( 'Background', 'khaveeai' ), initialOpen: true },
				createElement( SelectControl, {
					label: __( 'Background type', 'khaveeai' ),
					value: bgType,
					options: BG_TYPE_OPTIONS,
					onChange: ( value ) => setAttributes( { bgType: value } ),
				} ),
				// ColorPalette has no built-in label prop — render a label element above it.
				createElement(
					'div',
					{ style: { marginBottom: 16 } },
					createElement(
						'p',
						{
							style: {
								fontSize: 11,
								fontWeight: 500,
								marginBottom: 4,
								textTransform: 'uppercase',
								letterSpacing: '0.05em',
								color: '#1e1e1e',
							},
						},
						__( 'Background color', 'khaveeai' )
					),
					createElement( ColorPalette, {
						value: bgColor,
						// Guard onChange regardless of disabled prop support in the installed
						// @wordpress/components version (belt-and-braces mutual-exclusivity).
						onChange: ( bgTransparent || bgType !== 'color' )
							? () => {}
							: ( value ) => setAttributes( { bgColor: value || '' } ),
						disabled: bgTransparent || bgType !== 'color',
					} )
				),
				createElement( ToggleControl, {
					label: __( 'Transparent background', 'khaveeai' ),
					help: __( 'Overlay mode — the avatar renders over the page behind it. Disables color and image.', 'khaveeai' ),
					checked: bgTransparent,
					onChange: ( value ) => setAttributes( { bgTransparent: value } ),
				} ),
				createElement(
					MediaUploadCheck,
					null,
					createElement( MediaUpload, {
						onSelect: ( media ) => setAttributes( { bgImageId: media.id } ),
						allowedTypes: [ 'image' ],
						value: bgImageId,
						render: ( { open } ) => createElement(
							'div',
							{ style: { marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 } },
							createElement(
								Button,
								{
									variant: 'secondary',
									onClick: open,
									disabled: bgTransparent || bgType !== 'image',
								},
								bgImageId > 0
									? __( 'Replace background image', 'khaveeai' )
									: __( 'Select background image', 'khaveeai' )
							),
							bgImageId > 0
								? createElement(
									Button,
									{
										variant: 'tertiary',
										style: { color: '#d63638' },
										disabled: bgTransparent || bgType !== 'image',
										onClick: () => {
											// UI-SPEC §Copywriting: destructive confirmation.
											if ( window.confirm( __( 'Remove background image and switch back to color?', 'khaveeai' ) ) ) {
												setAttributes( { bgImageId: 0, bgType: 'color' } );
											}
										},
									},
									__( 'Remove', 'khaveeai' )
								)
								: null
						),
					} )
				)
			),

			// ── Panel 3 — Lighting ───────────────────────────────────────
			createElement(
				PanelBody,
				{ title: __( 'Lighting', 'khaveeai' ), initialOpen: false },
				createElement( RangeControl, {
					label: __( 'Light intensity', 'khaveeai' ),
					help: __( '0 is dark, 2 is bright. Default 1.', 'khaveeai' ),
					value: live.lightIntensity > 0 ? live.lightIntensity : undefined,
					min: 0,
					max: 2,
					step: 0.1,
					onChange: ( value ) => debouncedAttr( 'lightIntensity', value ),
				} )
			),

			// ── Panel 4 — Avatar ─────────────────────────────────────────
			createElement(
				PanelBody,
				{ title: __( 'Avatar', 'khaveeai' ), initialOpen: false },
				// Model picker (carried forward from Phase 8, regrouped here).
				createElement(
					MediaUploadCheck,
					null,
					createElement( MediaUpload, {
						onSelect: ( media ) => setAttributes( { avatar: media.id } ),
						allowedTypes: [ 'model/gltf-binary', 'application/octet-stream' ],
						value: avatar,
						render: ( { open } ) =>
							createElement(
								Button,
								{ variant: 'secondary', onClick: open },
								avatar
									? __( 'Replace avatar', 'khaveeai' )
									: __( 'Select avatar (using global default)', 'khaveeai' )
							),
					} )
				),
				createElement( RangeControl, {
					label: __( 'Avatar scale', 'khaveeai' ),
					help: __( '1 is normal size.', 'khaveeai' ),
					value: live.avatarScale > 0 ? live.avatarScale : undefined,
					min: 0.5,
					max: 2.0,
					step: 0.05,
					onChange: ( value ) => debouncedAttr( 'avatarScale', value ),
				} ),
				createElement( RangeControl, {
					label: __( 'Horizontal offset', 'khaveeai' ),
					help: __( 'Move the avatar left or right.', 'khaveeai' ),
					// avatarOffsetX range includes 0 as a meaningful centre position;
					// pass raw value so the slider centres at 0 (which also happens to
					// be the attribute default for "use global default").
					value: live.avatarOffsetX,
					min: -1.0,
					max: 1.0,
					step: 0.05,
					onChange: ( value ) => debouncedAttr( 'avatarOffsetX', value ),
				} ),
				createElement( RangeControl, {
					label: __( 'Vertical offset', 'khaveeai' ),
					help: __( 'Move the avatar up or down.', 'khaveeai' ),
					value: live.avatarOffsetY,
					min: -1.0,
					max: 1.0,
					step: 0.05,
					onChange: ( value ) => debouncedAttr( 'avatarOffsetY', value ),
				} )
			),

			// ── Panel 5 — Camera ─────────────────────────────────────────
			// CONTEXT locked decision: preset dropdown ONLY — no free-form
			// XYZ/target controls. The four listed options are the complete set.
			createElement(
				PanelBody,
				{ title: __( 'Camera', 'khaveeai' ), initialOpen: false },
				createElement( SelectControl, {
					label: __( 'Camera preset', 'khaveeai' ),
					help: __( 'Controls how the avatar is framed.', 'khaveeai' ),
					value: cameraPreset,
					options: CAMERA_PRESET_OPTIONS,
					onChange: ( value ) => setAttributes( { cameraPreset: value } ),
				} )
			),

			// ── Panel 6 — Voice & Behavior ───────────────────────────────
			// Existing Phase 8 controls (Voice select + Instructions textarea)
			// regrouped under this panel name per UI-SPEC §Copywriting.
			createElement(
				PanelBody,
				{ title: __( 'Voice & Behavior', 'khaveeai' ), initialOpen: false },
				createElement( SelectControl, {
					label: __( 'Voice', 'khaveeai' ),
					value: voice,
					options: VOICE_OPTIONS,
					onChange: ( value ) => setAttributes( { voice: value } ),
				} ),
				createElement( TextareaControl, {
					label: __( 'Instructions', 'khaveeai' ),
					value: instructions,
					placeholder: __( '(using global default)', 'khaveeai' ),
					onChange: ( value ) => setAttributes( { instructions: value } ),
				} )
			),

			// ── Panel 7 — Chat Box ───────────────────────────────────────
			createElement(
				PanelBody,
				{ title: __( 'Chat Box', 'khaveeai' ), initialOpen: false },
				createElement( ToggleControl, {
					label: __( 'Show chat box', 'khaveeai' ),
					help: __( 'Display a text chat panel beside or below the avatar.', 'khaveeai' ),
					checked: chatShow,
					onChange: ( value ) => setAttributes( { chatShow: value } ),
				} ),
				createElement( SelectControl, {
					label: __( 'Chat box position', 'khaveeai' ),
					value: chatPlacement,
					options: CHAT_PLACEMENT_OPTIONS,
					// Mutual-exclusivity: greyed when chat is hidden (UI-SPEC §Mutual-exclusivity).
					disabled: ! chatShow,
					onChange: ( value ) => setAttributes( { chatPlacement: value } ),
				} ),
				// Preview-talking drives the editor mouth-animation demo. It is
				// editor-only local state — NOT a persisted block attribute — so it
				// calls setPreviewTalking (not setAttributes).
				// UI-SPEC §Mutual-exclusivity correction: stays ENABLED regardless of
				// chatShow — it animates the avatar, not the chat panel.
				createElement( ToggleControl, {
					label: __( 'Preview talking', 'khaveeai' ),
					help: __( 'Play a sample mouth animation in the editor. Visitors see real lip-sync on the published page.', 'khaveeai' ),
					checked: previewTalking,
					onChange: setPreviewTalking,
				} )
			)
		),

		// ── Editor canvas — preview mount-point div ───────────────────────
		// The separately-enqueued khaveeai-preview.js bundle (Plan 09-06)
		// scans for [data-khaveeai-preview-config] and mounts the R3F scene
		// here. Before the preview bundle loads, the fallback banner below
		// is visible so the author can see and select the block.
		//
		// data-khaveeai-preview-config is rebuilt on every edit() re-render
		// (Gutenberg re-renders on every setAttributes call AND on local
		// state changes), so the preview bundle's MutationObserver always
		// sees the current config including in-progress RangeControl drags
		// (live.* overrides the debounced attribute values above).
		createElement(
			'div',
			{
				'data-khaveeai-preview-config': previewConfig,
				style: {
					minHeight: 200,
					border: '1px dashed #757575',
					borderRadius: 4,
					marginTop: 8,
					position: 'relative',
					overflow: 'hidden',
				},
			},
			// Fallback banner — visible before khaveeai-preview.js mounts.
			// UI-SPEC §Copywriting "Editor-preview banner" copy verbatim.
			// The preview bundle replaces this with the live 3D scene on mount.
			createElement(
				'div',
				{
					className: 'khaveeai-editor-preview-banner',
					style: {
						padding: 24,
						textAlign: 'center',
					},
				},
				createElement(
					'p',
					{ style: { margin: 0, fontWeight: 600, fontSize: 16 } },
					__( 'Khavee AI Avatar — preview', 'khaveeai' )
				),
				createElement(
					'p',
					{ style: { margin: '8px 0 0', color: '#757575', fontSize: 14 } },
					__( 'Live preview — view the published page to talk.', 'khaveeai' )
				)
			)
		)
	);
}

registerBlockType( metadata.name, {
	...metadata,
	edit: Edit,
	save: () => null,
} );
