const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder
} = require('discord.js');
const fs = require('fs');
const config = require('./config.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

client.once('ready', async () => {
  console.log(`🟢 ${client.user.tag} is online.`);

  // Set the status
  client.user.setActivity('Guild_Name_Here', { type: 3 }); // 3 = Watching

  const commands = [
    new SlashCommandBuilder()
      .setName('globalban')
      .setDescription('Globally ban a user from all servers.')
      .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for ban').setRequired(true)),

    new SlashCommandBuilder()
      .setName('globalkick')
      .setDescription('Globally kick a user from all servers.')
      .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true))
      .addStringOption(opt => opt.setName('reason').setDescription('Reason for kick').setRequired(true)),

    new SlashCommandBuilder()
      .setName('globalnick')
      .setDescription('Globally change a user\'s nickname across all servers.')
      .addUserOption(opt => opt.setName('user').setDescription('User to change nickname for').setRequired(true))
      .addStringOption(opt => opt.setName('nickname').setDescription('New nickname').setRequired(true)),

    new SlashCommandBuilder()
      .setName('globalunban')
      .setDescription('Globally unban a user from all servers.')
      .addUserOption(opt => opt.setName('user').setDescription('User to unban').setRequired(true))
  ];

  try {
    await client.application.commands.set(commands);
    console.log('✅ Commands registered globally');
  } catch (err) {
    console.error('Error registering commands:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    const { commandName, options, member, guild } = interaction;

    if (interaction.guild.id !== config.mainGuildId) {
      return interaction.reply({ content: '🚫 This command can only be used in the main guild.', ephemeral: true });
    }

    if (!config.adminRoles.some(r => member.roles.cache.has(r))) {
      return interaction.reply({ content: '🚫 You do not have permission to use this command.', ephemeral: true });
    }

    const user = options.getUser('user');
    const reason = options.getString('reason') || 'No reason provided.';
    const nickname = options.getString('nickname');
    const action = commandName === 'globalban' ? 'Global Ban' :
                   commandName === 'globalkick' ? 'Global Kick' :
                   commandName === 'globalnick' ? 'Global Nickname' : 'Global Unban';

    const embed = createLogEmbed(action, guild.iconURL(), user, member.user, reason, nickname);

    const adminRoleMentions = config.adminRoles.map(roleId => `<@&${roleId}>`).join(' ');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`confirm_${commandName}_${user.id}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel_action').setLabel('❌ Cancel').setStyle(ButtonStyle.Secondary)
    );

    const logChannel = await client.channels.fetch(config.logChannel);
    await logChannel.send({
      embeds: [embed],
      components: [row],
      content: adminRoleMentions
    });

    await interaction.reply({
      content: `✅ ${action} requested for <@${user.id}>. Waiting for confirmation in <#${logChannel.id}>.`,
      ephemeral: true
    });

  } else if (interaction.isButton()) {
    const [actionType, command, userId] = interaction.customId.split('_');
    if (!['confirm', 'cancel'].includes(actionType)) return;

    if (!config.adminRoles.some(r => interaction.member.roles.cache.has(r))) {
      return interaction.reply({ content: '🚫 You are not authorized to confirm or cancel actions.', ephemeral: true });
    }

    if (actionType === 'cancel') {
      return interaction.update({ content: '❌ Action has been cancelled.', components: [], embeds: [] });
    }

    try {
      const reasonField = interaction.message.embeds[0]?.fields?.find(f => f.name.includes('Reason'));
      const reason = reasonField?.value || 'No reason';
      const nicknameField = interaction.message.embeds[0]?.fields?.find(f => f.name.includes('Nickname'));
      const nickname = nicknameField?.value || '';

      for (const guildId of config.guilds) {
        const g = await client.guilds.fetch(guildId);
        const member = await g.members.fetch(userId).catch(() => null);

        if (!member && command !== 'globalunban') continue;

        if (command === 'globalban') await g.bans.create(userId, { reason });
        if (command === 'globalkick') await member?.kick(reason);
        if (command === 'globalnick') await member?.setNickname(nickname);
        if (command === 'globalunban') await g.bans.remove(userId);
      }

      if (config.autoDMOnConfirm) {
        const user = await client.users.fetch(userId);
        const dmMessage = command === 'globalban'
          ? `You have been globally banned from all servers for the following reason: ${reason}.`
          : command === 'globalkick'
            ? `You have been globally kicked from all servers for the following reason: ${reason}.`
            : command === 'globalnick'
              ? `Your nickname has been globally changed across all servers to: ${nickname || 'No nickname set'}.`
              : `You have been globally unbanned from all servers.`;
        try {
          await user.send(dmMessage);
        } catch (err) {
          console.error('Failed to send DM:', err);
        }
      }

      const confirmEmbed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle(`${command.charAt(0).toUpperCase() + command.slice(1)} - Action Confirmed`)
        .setThumbnail(interaction.guild.iconURL())
        .setDescription(`Action has been successfully completed!`)
        .addFields(
          { name: '👤 **Target User**', value: `<@${userId}>`, inline: true },
          { name: '🛡️ **Staff Member**', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📅 **Date Issued**', value: new Date().toLocaleString(), inline: true },
          { name: '📝 **Reason**', value: reason, inline: false },
          { name: '🔄 **Action Performed**', value: `**${command.charAt(0).toUpperCase() + command.slice(1)}**`, inline: false },
        )
        .setFooter({ text: `Executed by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.update({ content: `✅ ${command.charAt(0).toUpperCase() + command.slice(1)} completed.`, components: [], embeds: [confirmEmbed] });

    } catch (err) {
      console.error('Error while processing the action:', err);
      await interaction.update({ content: '❌ Something went wrong. Please try again later.', components: [], embeds: [] });
    }
  }
});

// Create the log embed
function createLogEmbed(action, serverIcon, user, staff, reason, nickname) {
  const fields = [
    { name: '👤 **Target User**', value: `<@${user.id}>`, inline: true },
    { name: '🛡️ **Staff Member**', value: `<@${staff.id}>`, inline: true },
    { name: '📅 **Date Issued**', value: new Date().toLocaleString(), inline: true },
    { name: '📝 **Reason**', value: reason, inline: false },
    { name: '🔄 **Action**', value: `${action}`, inline: false }
  ];

  if (action === 'Global Nickname') {
    fields.push({ name: '🆕 **New Nickname**', value: nickname || 'Not provided', inline: false });
  }

  return new EmbedBuilder()
    .setColor('#ff0000')
    .setTitle(`${action} Requested`)
    .setThumbnail(serverIcon)
    .setDescription(`A **${action}** action has been requested for **${user.username}**.`)
    .addFields(fields)
    .setFooter({ text: `Requested by ${staff.tag}`, iconURL: staff.displayAvatarURL() })
    .setTimestamp();
}

client.login(config.token);
