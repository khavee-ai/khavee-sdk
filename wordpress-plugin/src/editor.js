/**
 * Gutenberg editor integration for the `khaveeai/avatar` block.
 *
 * CRITICAL: this file imports NOTHING from the khaveeai React package,
 * the khaveeai OpenAI-realtime provider package, or the khaveeai core
 * package — the 10-voice list below is duplicated locally rather than
 * imported, so the editor bundle can never pull in the SPA/mic/WebRTC
 * code (EMBED-05, RESEARCH Pitfall 3). The block preview is a static server-rendered
 * <ServerSideRender> hitting AvatarBlock::render_callback over REST — the
 * live SPA never mounts while editing.
 *
 * Uses @wordpress/element's createElement (not bare react/JSX) so WP
 * core's bundled React version is irrelevant to this file.
 *
 * Source lives in wordpress-plugin/src/ (NOT inside assets/) so that
 * @wordpress/scripts' webpack `output.clean` (which wipes the
 * --output-path directory before each build) never deletes this source
 * file — assets/ is build OUTPUT only.
 *
 * AvatarBlock::render_callback()'s output is an EMPTY mount-point <div> by
 * design (the live SPA bundle, which would otherwise paint the avatar, is
 * never loaded here per EMBED-05) — so ServerSideRender alone renders
 * nothing visible in the editor canvas. The static placeholder box below
 * wraps it purely so an editor can see/select the block; it adds no SPA
 * imports and does not affect what render_callback() itself returns.
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
} from '@wordpress/components';
import ServerSideRender from '@wordpress/server-side-render';
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

function Edit( { attributes, setAttributes } ) {
	const { voice, instructions, avatar } = attributes;
	const blockProps = useBlockProps();

	return createElement(
		'div',
		blockProps,
		createElement(
			InspectorControls,
			null,
			createElement(
				PanelBody,
				{ title: __( 'Khavee AI Avatar Settings', 'khaveeai' ), initialOpen: true },
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
				} ),
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
				)
			)
		),
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
			),
			createElement( ServerSideRender, {
				block: 'khaveeai/avatar',
				attributes: { voice, instructions, avatar },
			} )
		)
	);
}

registerBlockType( metadata.name, {
	...metadata,
	edit: Edit,
	save: () => null,
} );
