const lastInstagramPostFileName = 'instagramSave.json';
const instagramUrl = 'https://www.instagram.com/';
const instagramPostUrl = 'https://www.instagram.com/p/';

const fs = require('fs');
const request = require('request');
const browser = new (require('zombie'))();

var save = {
	lastInstagramPost: '',
	lastInstagramStory: ''
}

exports.instagramName = ''; //The name of the user on Instagram.
exports.instagramId = ''; //The ID of the user on Instagram.
exports.channelId = ''; //The Discord channel ID.
exports.client = null; //A client created with 'new Discord.Client()' from the Discord.js library.
exports.instagramSessionCookie = {}; //A session cookie to log into Instagram.
exports.checkInterval = 300000; //The interval for checking Instagram in milliseconds.
exports.formatString = ''; //The format string to display the date and time of a post/story.
exports.locale = 'en'; //The locale to display date and time information.
exports.attachMedia = true; //If true, the media files are attached to the message, otherwise links with preview are posted.

/**
 * Starts checking an Instagram account for new posts and send them to the Discord.
 */
exports.startInstagramChecking = function ()
{
	fs.readFile(lastInstagramPostFileName, function (err, data)
		{
			save = JSON.parse(data);
			save.save = function () { fs.writeFile(lastInstagramPostFileName, JSON.stringify(this), () => {}); };

			browser.setCookie({ name: 'sessionid', domain: 'instagram.com', value: exports.instagramSessionCookie });
			
			setInterval(checkInstagram, exports.checkInterval); //Check every five minutes.
			checkInstagram();
		}
	);
}

function checkInstagram ()
{
	getPosts();
	getStories();
}

function getPosts ()
{
	getDataFromUrl(instagramUrl + exports.instagramName, function (data)
		{
			if ((data == undefined) || (data.length == 0))
				return;

			let container = {
				postsToSend: [], //Array to hold prepared posts so we can send them in the correct order after going through all new Instagram posts.
				links: [], //Array for all media links.
				workers: 1, //Numbers of workers working at the post gathering.
				finished: 0, //Number of finished workers.
				lastInstagramPost: data[0].node.shortcode
			}

			for (i = 0; i < data.length; i++)
			{
				let node = data[i].node;

				if (node.shortcode == save.lastInstagramPost)
					break;

				let link = instagramPostUrl + node.shortcode;

				let text = '@everyone' + "\r\n\r\n" +
						   getDateTimeFromUnix(node.taken_at_timestamp) + ':' + "\r\n" +
						   node.edge_media_to_caption.edges[0].node.text + "\r\n\r\n";

				text += '<' + link + '>' + "\r\n"; //Prevent preview of main link in Instagram stories because of the following direct media links.

				container.postsToSend.push(text);

				if (exports.attachMedia)
					container.links[i] = [];

				startWorker(link, container, i);
			}

			workerFinished(container);
		}
	);
}

function getStories ()
{
	browser.visit('https://www.instagram.com/graphql/query/?query_hash=45246d3fe16ccc6577e0bd297a5db1ab&variables={"reel_ids":["' + exports.instagramId + '"],"precomposed_overlay":false}', function()
		{
			let data = browser.text();

			if (data == '')
				return;

			data = JSON.parse(data).data;

			if (data.reels_media.length == 0)
				return;

			data = data.reels_media[0].items;

			let postsToSend = [];
			let links = [];

			for (i = data.length - 1; i >= 0; i--)
			{
				if (data[i].id == save.lastInstagramStory)
					break;

				let text = getDateTimeFromUnix(data[i].taken_at_timestamp) + ':' + "\r\n";

				if (data[i].is_video)
				{
					//Go through all videos listet to find the main one, having the highest/native resolution:
					let videos = data[i].video_resources;
					for (j = 0; j < videos.length; j++)
						if (videos[j].profile == 'MAIN')
						{
							if (exports.attachMedia)
								links.push(getPathFromUrl(videos[j].src));
							else
								text += videos[j].src;

							break;
						}
				}
				else
				{
					if (exports.attachMedia)
						links.push(getPathFromUrl(data[i].display_url));
					else
						text += data[i].display_url;
				}

				postsToSend.push(text);
			}

			//Send all stories, backwards through postsToSend for the correct order from old to new:
			for (i = postsToSend.length - 1; i >= 0; i--)
			{
				let targetChannel = exports.client.channels.get(exports.channelId);

				if (exports.attachMedia)
				{
					targetChannel.send(postsToSend[i], { files: [files[i]] }).catch(
						(error) =>
						{
							console.error(error);
						}
					);
				}
				else
				{
					targetChannel.send(postsToSend[i]).catch(
						(error) =>
						{
							console.error(error);
						}
					);
				}
			}

			if (postsToSend.length > 0)
			{
				save.lastInstagramStory = data[data.length - 1].id;
				save.save();
			}
		}
	);
}

function getDataFromUrl (url, callback)
{
	request(url, function (error, response, body)
		{
			if (error)
				console.log(error);

			callback(getDataFromHtml(body));
		}
	);
}

function getDataFromHtml (body)
{
	let startIndex = body.indexOf('window._sharedData = ') + 21;
	let endIndex = body.indexOf('window.__initialDataLoaded(window._sharedData);'); //First unique value after the full JSON.

	let data = body.substr(0, endIndex).substr(startIndex);
	let lastPositionAfterBracket = data.length - 1;

	//We have to go backwards to find the end of the JSON (a closing bracket) because the first unique value is anywhere near behind the JSON.
	while ((data.charAt(lastPositionAfterBracket) != '}') && (lastPositionAfterBracket > 0))
		lastPositionAfterBracket--;

	if (lastPositionAfterBracket <= 0)
	{
		console.log('No data was given back from Instagram or a parsing error.');
		return;
	}

	data = data.substr(0, lastPositionAfterBracket + 1);
	data = JSON.parse(data);
	data = data.entry_data;

	if (data.ProfilePage != undefined)
		data = data.ProfilePage[0].graphql.user.edge_owner_to_timeline_media.edges; //Index page
	else
	{
		data = data.PostPage[0].graphql.shortcode_media;

		if (data.edge_sidecar_to_children != undefined)
			data = data.edge_sidecar_to_children.edges; //Galery page
		else
			data = [{node: data}]; //Single media file page.
	}

	return data;
}

function startWorker (link, container, index)
{
	container.workers++;

	getDataFromUrl(link, function (data)
		{
			for (i = 0; i < data.length; i++)
			{
				container.postsToSend[index] += "\r\n";

				let targetUrl = '';

				if (data[i].node.is_video)
					targetUrl = data[i].node.video_url;
				else
					targetUrl = data[i].node.display_url;

				targetUrl = getPathFromUrl(targetUrl);

				if (exports.attachMedia)
					container.links[index].push(targetUrl); //The direct link will later be attached to the Discord message.
				else
					container.postsToSend[index] += targetUrl;
			}

			workerFinished(container);
		}
	);
}

function workerFinished (container)
{
	container.finished++;

	if (container.workers == container.finished)
	{
		//Send all posts, backwards through postsToSend for the correct order from old to new:
		for (i = container.postsToSend.length - 1; i >= 0; i--)
		{
			let targetChannel = exports.client.channels.get(exports.channelId);

			if (exports.attachMedia)
				targetChannel.send(container.postsToSend[i], { files: container.links[i] }).catch(() => {});
				targetChannel.send(container.postsToSend[i], { files: files }).catch(
					(error) =>
					{
						console.error(error);
					}
				);
			}
			else
			{
				targetChannel.send(container.postsToSend[i]).catch(
					(error) =>
					{
						console.error(error);
					}
				);
			}
		}

		//When there was a new post, store the newest post ID on the harddrive:
		if (container.postsToSend.length > 0)
		{
			save.lastInstagramPost = container.lastInstagramPost;

			save.save();
		}
	}
}

function getDateTimeFromUnix (unixTimestamp)
{
	let dateTime = require('moment').unix(unixTimestamp);

	dateTime.locale(exports.locale);

	if (exports.formatString == '')
		return dateTime.format();
	else
		return dateTime.format(exports.formatString);
}

function getPathFromUrl(url)
{
	return url.split(/[?#]/)[0];
}