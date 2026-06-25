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
 * below (added in Task 2). editor.js rewrites this attribute on every
 * edit() re-render (Gutenberg re-renders on every setAttributes call), so
 * the preview bundle's MutationObserver (Plan 09-03) always sees fresh
 * values.
 *
 * Uses @wordpress/element's createElement (not bare react/JSX) so WP
 * core's bundled React version is irrelevant to this file.
 *
 * Source lives in wordpress-plugin/src/ (NOT inside assets/) so that
 * @wordpress/scripts' webpack `output.clean` never deletes this source
 * file — assets/ is build OUTPUT only.
 */

import { registerBlockType } from '@wordpress/blocks';
import { createElement } from '@wordpress/element';
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
					value: containerWidth > 0 ? containerWidth : undefined,
					min: 200,
					max: 1200,
					onChange: ( value ) => setAttributes( { containerWidth: value } ),
				} ),
				createElement( RangeControl, {
					label: __( 'Container height (px)', 'khaveeai' ),
					help: __( 'Leave blank to use the global default.', 'khaveeai' ),
					value: containerHeight > 0 ? containerHeight : undefined,
					min: 200,
					max: 1200,
					onChange: ( value ) => setAttributes( { containerHeight: value } ),
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
					value: lightIntensity > 0 ? lightIntensity : undefined,
					min: 0,
					max: 2,
					step: 0.1,
					onChange: ( value ) => setAttributes( { lightIntensity: value } ),
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
					value: avatarScale > 0 ? avatarScale : undefined,
					min: 0.5,
					max: 2.0,
					step: 0.05,
					onChange: ( value ) => setAttributes( { avatarScale: value } ),
				} ),
				createElement( RangeControl, {
					label: __( 'Horizontal offset', 'khaveeai' ),
					help: __( 'Move the avatar left or right.', 'khaveeai' ),
					// avatarOffsetX range includes 0 as a meaningful centre position;
					// pass raw value so the slider centres at 0 (which also happens to
					// be the attribute default for "use global default").
					value: avatarOffsetX,
					min: -1.0,
					max: 1.0,
					step: 0.05,
					onChange: ( value ) => setAttributes( { avatarOffsetX: value } ),
				} ),
				createElement( RangeControl, {
					label: __( 'Vertical offset', 'khaveeai' ),
					help: __( 'Move the avatar up or down.', 'khaveeai' ),
					value: avatarOffsetY,
					min: -1.0,
					max: 1.0,
					step: 0.05,
					onChange: ( value ) => setAttributes( { avatarOffsetY: value } ),
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
				// Preview-talking is editor-only local state (Task 2 wires it to useState).
				// UI-SPEC §Mutual-exclusivity correction: stays ENABLED regardless of
				// chatShow — it animates the avatar, not the chat panel.
				createElement( ToggleControl, {
					label: __( 'Preview talking', 'khaveeai' ),
					help: __( 'Play a sample mouth animation in the editor. Visitors see real lip-sync on the published page.', 'khaveeai' ),
					checked: false,
					onChange: () => {},
				} )
			)
		),

		// ── Editor canvas — placeholder (replaced by mount-point div in Task 2) ──
		createElement(
			'div',
			{
				style: {
					border: '1px dashed #757575',
					borderRadius: 4,
					padding: 24,
					marginTop: 8,
					textAlign: 'center',
					background: '#f0f0f0',
				},
			},
			createElement(
				'p',
				{ style: { margin: 0, fontWeight: 600 } },
				__( 'Khavee AI Avatar', 'khaveeai' )
			),
			createElement(
				'p',
				{ style: { margin: '4px 0 0', color: '#757575', fontSize: 13 } },
				__( 'Live preview is not shown in the editor — view the published page to see the avatar.', 'khaveeai' )
			)
		)
	);
}

registerBlockType( metadata.name, {
	...metadata,
	edit: Edit,
	save: () => null,
} );
