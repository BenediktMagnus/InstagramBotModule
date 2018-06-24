const lastInstagramPostFileName = 'lastInstagramPost.txt';
const instagramUrl = 'https://www.instagram.com/';
const instagramPostUrl = 'https://www.instagram.com/p/';

const fs = require('fs');
const request = require('request');

var lastInstagramPost = '';

exports.instagramName = ''; //The name of the user on Instagram.
exports.channelId = ''; //The Discord channel ID.
exports.client = null; //A client created with 'new Discord.Client()' from the Discord.js library.
exports.checkInterval = 300000; //The interval for checking Instagram in milliseconds.

/**
 * Starts checking an Instagram account for new posts and send them to the Discord.
 */
exports.startInstagramChecking = function ()
{
	fs.readFile(lastInstagramPostFileName, function (err, data)
		{
			lastInstagramPost = data;
			
			setInterval(checkInstagram, exports.checkInterval); //Check every five minutes.
			checkInstagram();
		}
	);
}

function checkInstagram ()
{
	getDataFromUrl(instagramUrl + exports.instagramName, function (data)
		{
			if ((data == undefined) || (data.length == 0))
				return;

			let container = {
				postsToSend: [], //Array to hold prepared posts so we can send them in the correct order after going through all new Instagram posts.
				workers: 1, //Numbers of workers working at the post gathering.
				finished: 0, //Number of finished workers.
				lastInstagramPost: data[0].node.shortcode
			}

			for (i = 0; i < data.length; i++)
			{
				let node = data[i].node;

				if (node.shortcode == lastInstagramPost)
					break;

				let link = instagramPostUrl + node.shortcode;
				let text = '@everyone' + "\r\n\r\n" + node.edge_media_to_caption.edges[0].node.text + "\r\n\r\n";

				let isStory = false;

				if (node.__typename == 'GraphSidecar')
				{
					text += '<' + link + '>' + "\r\n"; //Prevent preview of main link in Instagram stories because of the following direct media links.
					isStory = true;
				}
				else
					text += link;

				container.postsToSend.push(text);

				if (isStory)
					startWorker(link, container, i);
			}

			workerFinished(container);
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
		data = data.PostPage[0].graphql.shortcode_media.edge_sidecar_to_children.edges; //Story page

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

				if (data[i].node.is_video)
					container.postsToSend[index] += data[i].node.video_url;
				else
					container.postsToSend[index] += data[i].node.display_url;
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
			exports.client.channels.get(exports.channelId).send(container.postsToSend[i]).catch(() => {});

		//When there was a new post, store the newest post ID on the harddrive:
		if (container.postsToSend.length > 0)
		{
			lastInstagramPost = container.lastInstagramPost;

			fs.writeFile(lastInstagramPostFileName, lastInstagramPost, () => {});
		}
	}
}